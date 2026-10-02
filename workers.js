```javascript
// ============================================================
// VissaPro Payment Verification Worker
// Cloudflare Workers + D1 + R2
// ============================================================

// CHANGE THESE VALUES
const ADMIN_KEY = "CHANGE_THIS_TO_A_LONG_RANDOM_ADMIN_KEY";

const ZIP_URL = "https://YOUR-ZIP-DOWNLOAD-LINK-HERE";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders()
      });
    }

    try {

      // -----------------------------
      // USER: SUBMIT PAYMENT
      // -----------------------------
      if (
        request.method === "POST" &&
        url.pathname === "/api/payment"
      ) {
        return await submitPayment(request, env);
      }


      // -----------------------------
      // USER: CHECK STATUS
      // -----------------------------
      if (
        request.method === "GET" &&
        url.pathname === "/api/status"
      ) {
        const email = url.searchParams.get("email");

        if (!email) {
          return json({
            error: "Email is required"
          }, 400);
        }

        const payment = await env.DB.prepare(`
          SELECT id, email, status, reason, created_at
          FROM payments
          WHERE email = ?
          ORDER BY created_at DESC
          LIMIT 1
        `).bind(email.toLowerCase()).first();

        if (!payment) {
          return json({
            status: null
          });
        }

        return json({
          status: payment.status,
          reason: payment.reason || null,
          zip_url:
            payment.status === "approved"
              ? ZIP_URL
              : null
        });
      }


      // -----------------------------
      // ADMIN: GET PAYMENTS
      // -----------------------------
      if (
        request.method === "GET" &&
        url.pathname === "/api/admin/payments"
      ) {

        if (!checkAdmin(request)) {
          return json({
            error: "Unauthorized"
          }, 401);
        }

        const result = await env.DB.prepare(`
          SELECT *
          FROM payments
          ORDER BY created_at DESC
        `).all();

        const stats = {
          pending: 0,
          approved: 0,
          rejected: 0
        };

        for (const payment of result.results) {
          if (stats[payment.status] !== undefined) {
            stats[payment.status]++;
          }
        }

        const payments = result.results.map(p => ({
          id: p.id,
          email: p.email,
          status: p.status,
          reason: p.reason,
          created_at: p.created_at,

          // R2 receipt endpoint
          receipt_url:
            `${url.origin}/api/admin/receipt/${p.receipt_key}`
        }));

        return json({
          stats,
          payments
        });
      }


      // -----------------------------
      // ADMIN: VIEW RECEIPT
      // -----------------------------
      if (
        request.method === "GET" &&
        url.pathname.startsWith("/api/admin/receipt/")
      ) {

        if (!checkAdmin(request)) {
          return json({
            error: "Unauthorized"
          }, 401);
        }

        const key =
          decodeURIComponent(
            url.pathname.replace("/api/admin/receipt/", "")
          );

        const object = await env.RECEIPTS.get(key);

        if (!object) {
          return new Response("Receipt not found", {
            status: 404,
            headers: corsHeaders()
          });
        }

        const headers = new Headers();

        object.writeHttpMetadata(headers);

        headers.set(
          "Cache-Control",
          "private, max-age=300"
        );

        addCors(headers);

        return new Response(object.body, {
          headers
        });
      }


      // -----------------------------
      // ADMIN: APPROVE
      // -----------------------------
      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/approve"
      ) {

        if (!checkAdmin(request)) {
          return json({
            error: "Unauthorized"
          }, 401);
        }

        const body = await request.json();

        if (!body.id) {
          return json({
            error: "Payment ID required"
          }, 400);
        }

        await env.DB.prepare(`
          UPDATE payments
          SET status = 'approved',
              reason = NULL
          WHERE id = ?
        `).bind(body.id).run();

        return json({
          success: true,
          status: "approved"
        });
      }


      // -----------------------------
      // ADMIN: REJECT
      // -----------------------------
      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/reject"
      ) {

        if (!checkAdmin(request)) {
          return json({
            error: "Unauthorized"
          }, 401);
        }

        const body = await request.json();

        if (!body.id) {
          return json({
            error: "Payment ID required"
          }, 400);
        }

        await env.DB.prepare(`
          UPDATE payments
          SET status = 'rejected',
              reason = ?
          WHERE id = ?
        `)
        .bind(
          body.reason || "Payment could not be verified.",
          body.id
        )
        .run();

        return json({
          success: true,
          status: "rejected"
        });
      }


      return json({
        error: "Not Found"
      }, 404);

    } catch (error) {

      console.error(error);

      return json({
        error: "Server error"
      }, 500);
    }
  }
};


// ============================================================
// SUBMIT PAYMENT
// ============================================================

async function submitPayment(request, env) {

  const form = await request.formData();

  const email = String(
    form.get("email") || ""
  ).trim().toLowerCase();

  const file = form.get("receipt");

  if (!email) {
    return json({
      error: "Email is required"
    }, 400);
  }

  if (!file || typeof file === "string") {
    return json({
      error: "Payment receipt is required"
    }, 400);
  }

  if (file.size > MAX_FILE_SIZE) {
    return json({
      error: "Receipt must be smaller than 10MB"
    }, 400);
  }

  const allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf"
  ];

  if (!allowedTypes.includes(file.type)) {
    return json({
      error: "Only JPG, PNG, WEBP or PDF files are allowed"
    }, 400);
  }


  // Unique ID
  const id =
    crypto.randomUUID();

  const extension =
    getExtension(file.name, file.type);

  const receiptKey =
    `${id}.${extension}`;


  // Upload receipt to R2
  await env.RECEIPTS.put(
    receiptKey,
    file.stream(),
    {
      httpMetadata: {
        contentType: file.type
      }
    }
  );


  // Save payment request
  await env.DB.prepare(`
    INSERT INTO payments
    (
      id,
      email,
      receipt_key,
      status,
      reason,
      created_at
    )
    VALUES (?, ?, ?, 'pending', NULL, ?)
  `)
  .bind(
    id,
    email,
    receiptKey,
    new Date().toISOString()
  )
  .run();


  return json({
    success: true,
    id,
    status: "pending"
  });
}


// ============================================================
// ADMIN AUTH
// ============================================================

function checkAdmin(request) {

  const auth =
    request.headers.get("Authorization");

  if (!auth) return false;

  const expected =
    "Bearer " + ADMIN_KEY;

  return auth === expected;
}


// ============================================================
// FILE EXTENSION
// ============================================================

function getExtension(name, type) {

  const original =
    String(name || "")
      .split(".")
      .pop()
      .toLowerCase();

  if (
    ["jpg", "jpeg", "png", "webp", "pdf"]
      .includes(original)
  ) {
    return original;
  }

  if (type === "image/jpeg") return "jpg";
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  if (type === "application/pdf") return "pdf";

  return "bin";
}


// ============================================================
// JSON RESPONSE
// ============================================================

function json(data, status = 200) {

  const headers = new Headers({
    "Content-Type": "application/json"
  });

  addCors(headers);

  return new Response(
    JSON.stringify(data),
    {
      status,
      headers
    }
  );
}


// ============================================================
// CORS
// ============================================================

function corsHeaders() {

  const headers = new Headers();

  addCors(headers);

  return headers;
}

function addCors(headers) {

  headers.set(
    "Access-Control-Allow-Origin",
    "*"
  );

  headers.set(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS"
  );

  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
}
```
