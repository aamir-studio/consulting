import { EmailMessage } from "cloudflare:email";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store"
    }
  });
}

function normalizeText(value, maxLength) {
  return String(value || "").replace(/\r\n/g, "\n").trim().slice(0, maxLength);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeSubmission(rawSubmission) {
  const submission = {
    firstName: normalizeText(rawSubmission.firstName, 100),
    lastName: normalizeText(rawSubmission.lastName, 100),
    email: normalizeText(rawSubmission.email, 254).toLowerCase(),
    website: normalizeText(rawSubmission.website, 300),
    message: normalizeText(rawSubmission.message, 4000),
    source: rawSubmission.source === "tutoring" ? "tutoring" : "consulting"
  };

  if (!submission.firstName || !submission.lastName || !submission.message) {
    throw new Error("The submission is incomplete.");
  }

  if (!EMAIL_PATTERN.test(submission.email)) {
    throw new Error("The submission email is invalid.");
  }

  return submission;
}

function buildTextBody(submission) {
  const lines = [
    `New ${submission.source} inquiry`,
    "",
    `First name: ${submission.firstName}`,
    `Last name: ${submission.lastName}`,
    `Email: ${submission.email}`
  ];

  if (submission.website) {
    lines.push(`Website: ${submission.website}`);
  }

  lines.push("", "How can I help?", submission.message);

  return lines.join("\n");
}

function buildHtmlBody(submission) {
  const safeMessage = escapeHtml(submission.message).replace(/\n/g, "<br>");
  const safeWebsite = submission.website
    ? `<p><strong>Website:</strong> <a href="${escapeHtml(submission.website)}">${escapeHtml(submission.website)}</a></p>`
    : "";

  return [
    "<html>",
    "  <body>",
    `    <h2>New ${submission.source} inquiry</h2>`,
    `    <p><strong>First name:</strong> ${escapeHtml(submission.firstName)}</p>`,
    `    <p><strong>Last name:</strong> ${escapeHtml(submission.lastName)}</p>`,
    `    <p><strong>Email:</strong> ${escapeHtml(submission.email)}</p>`,
    `    ${safeWebsite}`,
    "    <p><strong>How can I help?</strong></p>",
    `    <p>${safeMessage}</p>`,
    "  </body>",
    "</html>"
  ].join("\r\n");
}

function buildRawEmail({ sender, senderName, recipient, replyTo, subject, textBody, htmlBody }) {
  const boundary = `cf-contact-${crypto.randomUUID()}`;

  return [
    `From: ${senderName} <${sender}>`,
    `To: <${recipient}>`,
    `Reply-To: <${replyTo}>`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    textBody,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    htmlBody,
    "",
    `--${boundary}--`,
    ""
  ].join("\r\n");
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
    }

    if (!env.CONTACT_FORM_SHARED_TOKEN) {
      return jsonResponse({ ok: false, error: "Missing contact form secret." }, 500);
    }

    if (request.headers.get("x-contact-form-token") !== env.CONTACT_FORM_SHARED_TOKEN) {
      return jsonResponse({ ok: false, error: "Unauthorized request." }, 401);
    }

    if (!env.CONTACT_FORM_SENDER || !env.CONTACT_FORM_RECIPIENT) {
      return jsonResponse({ ok: false, error: "Missing sender or recipient settings." }, 500);
    }

    let submission;

    try {
      const rawSubmission = await request.json();
      submission = normalizeSubmission(rawSubmission);
    } catch (error) {
      return jsonResponse({ ok: false, error: error.message || "Invalid submission." }, 400);
    }

    // tutoring form -> tutoring inbox; everything else -> consulting inbox
    const tutoring = submission.source === "tutoring";
    const recipient = (tutoring && env.TUTORING_FORM_RECIPIENT) || env.CONTACT_FORM_RECIPIENT;

    const rawEmail = buildRawEmail({
      sender: env.CONTACT_FORM_SENDER,
      senderName: tutoring ? "Aamir Tutoring Contact Form" : "Aamir Consulting Contact Form",
      recipient,
      replyTo: submission.email,
      subject: tutoring
        ? "New tutoring inquiry via aamir.consulting/tutoring"
        : "New consulting inquiry via aamir.consulting",
      textBody: buildTextBody(submission),
      htmlBody: buildHtmlBody(submission)
    });

    const message = new EmailMessage(
      env.CONTACT_FORM_SENDER,
      recipient,
      rawEmail
    );

    try {
      await env.CONTACT_SEND_EMAIL.send(message);
    } catch (error) {
      return jsonResponse(
        { ok: false, error: error.message || "Unable to send the email." },
        502
      );
    }

    return jsonResponse({ ok: true });
  }
};
