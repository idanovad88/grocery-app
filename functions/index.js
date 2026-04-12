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
        q: 'subject:(חשבון OR invoice OR "לתשלום") newer_than:60d',
        maxResults: 30,
      });
      messages = list.data.messages || [];
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

      // Recursively extract plain-text body parts
      const extractTextParts = (parts) => {
        for (const p of parts || []) {
          if (p.mimeType === "text/plain" && p.body?.data)
            text += decodeB64(p.body.data) + "\n";
          if (p.parts) extractTextParts(p.parts);
        }
      };

      const payload = msg.data.payload || {};
      if (payload.parts) {
        extractTextParts(payload.parts);
      } else if (payload.body?.data) {
        text = decodeB64(payload.body.data);
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

      if (!text.trim()) continue;

      // Send text to Claude Haiku for structured extraction
      try {
        const today    = new Date().toISOString().split("T")[0];
        const response = await anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 512,
          messages: [{
            role: "user",
            content: `Today is ${today}. Extract bill payment requests from the following text (Hebrew or English).
Return ONLY a valid JSON array: [{ "provider": string, "amount": number, "dueDate": "YYYY-MM-DD" }]
If no bill is found, return []. No explanation, no markdown.

TEXT:
${text.slice(0, 5000)}`,
          }],
        });

        const raw       = response.content[0].text.trim()
          .replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
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
      } catch {
        // Claude or JSON parse failure — skip this message
      }
    }

    return { bills: results };
  }
);
