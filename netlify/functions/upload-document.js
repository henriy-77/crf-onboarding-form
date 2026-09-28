/**
 * Contributory Reserve Fund — Document Upload Handler
 * Accepts a single document as base64, stores in Netlify Blobs,
 * then patches the Airtable record with the download URL.
 */

const { getStore } = require("@netlify/blobs");

const AIRTABLE_TABLE = "CRF Applications";

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
  }

  const AIRTABLE_TOKEN   = process.env.AIRTABLE_TOKEN;
  const AIRTABLE_BASE_ID = process.env.AIRTABLE_CRF_BASE_ID;
  const SHARED_SECRET    = process.env.SHARED_SECRET;
  const SITE_ID          = process.env.NETLIFY_SITE_ID;
  const BLOB_TOKEN       = process.env.NETLIFY_TOKEN   || process.env.NETLIFY_BLOBS_TOKEN;

  const incomingSecret = event.headers["x-shared-secret"] || "";
  if (SHARED_SECRET && incomingSecret !== SHARED_SECRET) {
    return json(401, { error: "Unauthorized" });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  const { ref, key, name, data } = payload;
  if (!ref || !key || !data) {
    return json(400, { error: "Missing ref, key, or data" });
  }

  // Store in Netlify Blobs
  let downloadUrl = null;
  if (SITE_ID && BLOB_TOKEN) {
    try {
      const base64   = data.includes(",") ? data.split(",")[1] : data;
      const mimeType = data.includes(";") ? data.split(";")[0].replace("data:", "") : "application/octet-stream";
      const buffer   = Buffer.from(base64, "base64");
      const store    = getStore({ name: "documents", siteID: SITE_ID, token: BLOB_TOKEN });
      await store.set(`${ref}/${key}`, buffer, { metadata: { name: name || key, mimeType, ref } });
      const siteUrl  = process.env.URL || "https://crf-onboarding.netlify.app";
      downloadUrl    = `${siteUrl}/.netlify/functions/get-document?ref=${encodeURIComponent(ref)}&doc=${encodeURIComponent(key)}`;
      console.log("Stored document:", `${ref}/${key}`);
    } catch (err) {
      console.error("Blobs store error:", err.message);
      return json(500, { error: "Failed to store document", detail: err.message });
    }
  } else {
    return json(500, { error: "Blobs not configured" });
  }

  // Fetch the Airtable record ID for this ref
  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
    return json(200, { stored: true, airtableSkipped: true });
  }

  try {
    const searchUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE)}?filterByFormula=${encodeURIComponent(`{Reference}="${ref}"`)}`;
    const searchRes = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
    });
    const searchData = await searchRes.json();
    if (!searchData.records || searchData.records.length === 0) {
      return json(404, { error: "Record not found in Airtable" });
    }

    const record    = searchData.records[0];
    const recordId  = record.id;
    const existing  = record.fields["Document Links"] || "";
    const newEntry  = `${key} (${name || key}): ${downloadUrl}`;
    const updated   = existing ? existing + "\n" + newEntry : newEntry;

    const patchUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE)}/${recordId}`;
    await fetch(patchUrl, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { "Document Links": updated } }),
    });

    console.log("Updated Document Links for", ref);
    return json(200, { success: true, downloadUrl });
  } catch (err) {
    console.error("Airtable patch error:", err.message);
    return json(500, { error: "Stored but failed to update Airtable", detail: err.message });
  }
};

function json(status, body) {
  return { statusCode: status, headers: { "Content-Type": "application/json", ...cors() }, body: JSON.stringify(body) };
}

function cors() {
  return {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Shared-Secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
