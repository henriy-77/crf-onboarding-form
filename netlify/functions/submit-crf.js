/**
 * Anchoria — Contributory Reserve Fund Submission Handler
 * Netlify Serverless Function → Airtable (CRF Applications table)
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

  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
    console.error("Missing AIRTABLE_TOKEN or AIRTABLE_CRF_BASE_ID env vars");
    return json(500, { error: "Server misconfiguration — contact admin" });
  }

  const incomingSecret = event.headers["x-shared-secret"] || "";
  if (SHARED_SECRET && incomingSecret !== SHARED_SECRET) {
    return json(401, { error: "Unauthorized" });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const str  = (v) => (v == null ? "" : String(v));
  const arr  = (v) => (Array.isArray(v) ? v.join(", ") : v || "");
  const date = (v) => (v ? v.slice(0, 10) : null);

  const ref  = str(payload.ref || payload.reference);
  const ed   = payload.entityDetails  || {};
  const fin  = payload.financial      || {};
  const decl = payload.declaration    || {};

  const directors = Array.isArray(payload.directors) ? payload.directors : [];
  const dirStr = directors.map((d, i) =>
    `Director ${i + 1}: ${d.fullName || d.name || ""}${d.bvn ? " | BVN: " + d.bvn : ""}${d.nin ? " | NIN: " + d.nin : ""}${d.phone ? " | Phone: " + d.phone : ""}${d.email ? " | Email: " + d.email : ""}`
  ).join("\n");

  const signatories = Array.isArray(payload.signatories) ? payload.signatories : [];
  const sigStr = signatories.map((s, i) =>
    `Signatory ${i + 1}: ${s.fullName || s.name || ""}${s.title ? " (" + s.title + ")" : ""}${s.mandate ? " | Mandate: " + s.mandate : ""}${s.phone ? " | Phone: " + s.phone : ""}${s.email ? " | Email: " + s.email : ""}`
  ).join("\n");

  const siteUrl = "https://onboard.anchoriaonline.com";

  const fields = {
    "Reference":              ref,
    "Entity Type":            str(ed.entityType),
    "Company Name":           str(ed.companyName),
    "RC Number":              str(ed.rcNumber),
    "Tax ID (TIN)":           str(ed.tin),
    "Date of Incorporation":  date(ed.incorporationDate),
    "Nature of Business":     str(ed.natureBusiness),
    "Registered Address":     str(ed.registeredAddress),
    "Operating Address":      str(ed.operatingAddress),
    "Email":                  str(ed.email),
    "Phone":                  str(ed.phone),
    "Website":                str(ed.website),
    "Directors":              dirStr,
    "Authorized Signatories": sigStr,
    "Bank Name":              str(fin.bankName),
    "Bank Branch":            str(fin.bankBranch),
    "Bank Account Number":    str(fin.accountNumber),
    "Bank Account Name":      str(fin.accountName),
    "DCS / Settlement":       str(fin.dcsNumber),
    "Source of Funds":        arr(fin.sourceOfFunds),
    "Source of Funds Details":str(fin.sourceDetails),
    "Annual Turnover":        str(fin.annualTurnover),
    "Investment Options":     arr(fin.investmentOptions),
    "Referral Source":        str(fin.referralSource),
    "Relationship Manager":   str(fin.relationshipManager),
    "Documents Submitted":    Array.isArray(payload.documents)
                                ? payload.documents.map((d) => `${d.key}: ${d.name}`).join("\n")
                                : "",
    "Document Links":         "",
    "Signatory Name":         str(decl.signatoryName),
    "Signature Date":         date(decl.date),
    "Source":                 str(payload.source) || "Direct",
    "Status":                 "New",
    "Notes":                  "",
  };

  Object.keys(fields).forEach((k) => {
    if (fields[k] === "" || fields[k] === null || fields[k] === undefined) {
      delete fields[k];
    }
  });

  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE)}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization:  `Bearer ${AIRTABLE_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields }),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error("Airtable API error:", res.status, detail);
      return json(502, { error: "Failed to save application", detail });
    }

    const result = await res.json();
    console.log("CRF application saved:", ref, "→ Airtable", result.id);

    const SITE_ID    = process.env.NETLIFY_SITE_ID;
    const BLOB_TOKEN  = process.env.NETLIFY_TOKEN  || process.env.NETLIFY_BLOBS_TOKEN;
    const sigData = decl.signature;
    if (sigData && SITE_ID && BLOB_TOKEN) {
      try {
        const store  = getStore({ name: "documents", siteID: SITE_ID, token: BLOB_TOKEN });
        const base64 = sigData.includes(",") ? sigData.split(",")[1] : sigData;
        const buffer = Buffer.from(base64, "base64");
        await store.set(`${ref}/signature`, buffer, { metadata: { name: "signature.png", mimeType: "image/png", ref } });
        console.log("Stored signature for", ref);
      } catch (err) {
        console.error("Failed to store signature:", err.message);
      }
    }

    return json(200, { success: true, reference: ref, airtableId: result.id });

  } catch (err) {
    console.error("Function error:", err);
    return json(500, { error: "Internal server error", detail: err.message });
  }
};

function json(status, body) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json", ...cors() },
    body: JSON.stringify(body),
  };
}

function cors() {
  return {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Shared-Secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
