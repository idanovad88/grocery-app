const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp }      = require("firebase-admin/app");
const { getFirestore }       = require("firebase-admin/firestore");
const { google }             = require("googleapis");
const Anthropic              = require("@anthropic-ai/sdk");
const pdf                    = require("pdf-parse");

initializeApp();

exports.scanGmailBills = onCall(
  { region: "us-central1", timeoutSeconds: 120, memory: "512MiB" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");

    const { googleAccessToken, householdId } = request.data;
    if (!googleAccessToken || !householdId)
      throw new HttpsError("invalid-argument", "Missing googleAccessToken or householdId");

    // Verify caller is a household member
    const db = getFirestore();
    const hh = await db.collection("households").doc(householdId).get();
    if (!hh.exists || !(hh.data().members || []).includes(request.auth.uid))
      throw new HttpsError("permission-denied", "Not a member of this household");

    // Set up Gmail client with the user's OAuth token
    const oauthClient = new google.auth.OAuth2();
    oauthClient.setCredentials({ access_token: googleAccessToken });
    const gmail = google.gmail({ version: "v1", auth: oauthClient });

    // Collect already-imported Gmail message IDs to avoid duplicates
    const existing = await db
      .collection("households").doc(householdId)
      .collection("bills").where("gmailMessageId", "!=", null).get();
    const knownIds = new Set(existing.docs.map(d => d.data().gmailMessageId));

    // Search Gmail for bill-like emails (last 60 days)
    let messages = [];
    try {
      const list = await gmail.users.messages.list({
        userId: "me",
        q: '(חשבון OR החשבון OR חשבונית OR החשבונית OR לתשלום OR חיוב OR invoice OR bill) newer_than:90d',
        maxResults: 30,
      });
      messages = list.data.messages || [];
      console.log(`Gmail search found ${messages.length} messages`);
    } catch (err) {
      console.error("Gmail list error:", err.message);
      throw new HttpsError("internal", "Failed to list Gmail messages");
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const results = [];

    for (const { id: msgId } of messages) {
      if (knownIds.has(msgId)) continue;

      // Fetch full message
      let msg;
      try {
        msg = await gmail.users.messages.get({ userId: "me", id: msgId, format: "full" });
      } catch {
        continue;
      }

      let text = "";

      // Decode base64url helper
      const decodeB64 = (data) =>
        Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");

      // Strip HTML tags to get readable text
      const stripHtml = (html) =>
        html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
            .replace(/\s{2,}/g, " ").trim();

      // Include email subject as context for Claude
      const headers = msg.data.payload?.headers || [];
      const subject = headers.find(h => h.name.toLowerCase() === "subject")?.value || "";
      if (subject) text += `נושא: ${subject}\n`;

      // Recursively extract plain-text and HTML body parts
      const extractTextParts = (parts) => {
        for (const p of parts || []) {
          if (p.mimeType === "text/plain" && p.body?.data)
            text += decodeB64(p.body.data) + "\n";
          else if (p.mimeType === "text/html" && p.body?.data)
            text += stripHtml(decodeB64(p.body.data)) + "\n";
          if (p.parts) extractTextParts(p.parts);
        }
      };

      const payload = msg.data.payload || {};
      if (payload.parts) {
        extractTextParts(payload.parts);
      } else if (payload.body?.data) {
        const raw = decodeB64(payload.body.data);
        text += payload.mimeType === "text/html" ? stripHtml(raw) : raw;
      }

      // Recursively extract and parse PDF attachments (≤ 8 MB)
      const processPdfs = async (parts) => {
        for (const p of parts || []) {
          if (
            p.mimeType === "application/pdf" &&
            p.body?.attachmentId &&
            (p.body.size || 0) <= 8 * 1024 * 1024
          ) {
            try {
              const att = await gmail.users.messages.attachments.get({
                userId: "me", messageId: msgId, id: p.body.attachmentId,
              });
              const buf    = Buffer.from(att.data.data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
              const parsed = await pdf(buf);
              text += parsed.text + "\n";
            } catch {
              // Skip unreadable or image-only PDFs
            }
          }
          if (p.parts) await processPdfs(p.parts);
        }
      };
      await processPdfs(payload.parts);

      console.log(`Message ${msgId}: extracted ${text.length} chars of text`);
      if (!text.trim()) { console.log(`Message ${msgId}: skipped (no text)`); continue; }

      // Send text to Claude Haiku for structured extraction
      try {
        const today    = new Date().toISOString().split("T")[0];
        console.log(`Message ${msgId}: sending to Claude. Text preview: ${text.slice(0, 200)}`);
        const response = await anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 512,
          messages: [{
            role: "user",
            content: `Today is ${today}. You are extracting household bill payment requests from Israeli company emails (Hebrew or English).

Return ONLY a valid JSON array: [{ "provider": string, "amount": number, "dueDate": "YYYY-MM-DD" }]
If no bill is found, return []. No explanation, no markdown.

Rules:
- provider: the company name (e.g. "מנהרות הכרמל", "חברת חשמל", "בזק", "HOT", "עיריית חיפה")
- amount: the total amount due in ₪ (look for: סכום לתשלום, סה"כ, לתשלום, חיוב, total)
- dueDate: payment due date in YYYY-MM-DD format (look for: תאריך לתשלום, תאריך פירעון, יש לשלם עד, due date)
- If due date is missing, estimate 30 days from today

Examples of Israeli bill patterns:
- "סכום לתשלום: 287.50 ₪" → amount: 287.50
- "תאריך פירעון: 15/05/2026" → dueDate: "2026-05-15"
- "החשבונית החודשית שלך ממנהרות הכרמל" → provider: "מנהרות הכרמל"
- "סה"כ לתשלום: 189 ש"ח" → amount: 189
- "יש לשלם עד 30/04/2026" → dueDate: "2026-04-30"

TEXT:
${text.slice(0, 5000)}`,
          }],
        });

        const raw       = response.content[0].text.trim()
          .replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
        console.log(`Message ${msgId}: Claude returned: ${raw.slice(0, 300)}`);
        const extracted = JSON.parse(raw);

        for (const bill of extracted) {
          if (bill.provider && bill.dueDate) {
            results.push({
              provider: bill.provider,
              amount: Number(bill.amount) || 0,
              dueDate: bill.dueDate,
              gmailMessageId: msgId,
              source: "gmail",
            });
          }
        }
      } catch (e) {
        console.error(`Message ${msgId}: Claude/parse error: ${e.message}`);
      }
    }

    return { bills: results };
  }
);
