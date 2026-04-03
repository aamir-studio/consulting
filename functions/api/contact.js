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

function redirectToContact(request, statusKey) {
  const url = new URL("/", request.url);
  url.hash = "contact";

  if (statusKey) {
    url.searchParams.set("contact", statusKey);
  }

  return Response.redirect(url.toString(), 303);
}

function wantsJson(request) {
  const accept = request.headers.get("accept") || "";
  const contentType = request.headers.get("content-type") || "";

  return accept.includes("application/json") || contentType.includes("application/json");
}

function errorResponse(request, message, status = 400) {
  if (wantsJson(request)) {
    return jsonResponse({ ok: false, error: message }, status);
  }

  return redirectToContact(request, "error");
}

function successResponse(request) {
  if (wantsJson(request)) {
    return jsonResponse({ ok: true, message: "Thanks. Your message has been sent." });
  }

  return redirectToContact(request, "success");
}

async function readSubmission(request) {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return await request.json();
  }

  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    const formData = await request.formData();
    return Object.fromEntries(formData.entries());
  }

  throw new Error("Unsupported submission format.");
}

function normalizeText(value, maxLength) {
  return String(value || "").replace(/\r\n/g, "\n").trim().slice(0, maxLength);
}

function validateSubmission(rawSubmission) {
  const submission = {
    firstName: normalizeText(rawSubmission["first-name"] || rawSubmission.firstName, 100),
    lastName: normalizeText(rawSubmission["last-name"] || rawSubmission.lastName, 100),
    email: normalizeText(rawSubmission.email, 254).toLowerCase(),
    confirmEmail: normalizeText(
      rawSubmission["confirm-email"] || rawSubmission.confirmEmail,
      254
    ).toLowerCase(),
    website: normalizeText(rawSubmission.website, 300),
    message: normalizeText(rawSubmission.message, 4000)
  };

  if (!submission.firstName || !submission.lastName) {
    throw new Error("Please include both your first and last name.");
  }

  if (!submission.email || !submission.confirmEmail) {
    throw new Error("Please include and confirm your email address.");
  }

  if (!EMAIL_PATTERN.test(submission.email) || !EMAIL_PATTERN.test(submission.confirmEmail)) {
    throw new Error("Please enter a valid email address.");
  }

  if (submission.email !== submission.confirmEmail) {
    throw new Error("Your email addresses do not match.");
  }

  if (submission.website) {
    let parsedUrl;

    try {
      parsedUrl = new URL(submission.website);
    } catch (error) {
      throw new Error("Please provide a full website URL, including https://.");
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new Error("Please provide a website URL that starts with http:// or https://.");
    }

    submission.website = parsedUrl.toString();
  }

  if (!submission.message) {
    throw new Error("Please tell me how I can help.");
  }

  return submission;
}

export async function onRequestGet() {
  return new Response("Method not allowed.", {
    status: 405,
    headers: {
      "allow": "POST"
    }
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.CONTACT_MAILER || typeof env.CONTACT_MAILER.fetch !== "function") {
    return errorResponse(
      request,
      "The contact form service is not configured yet. Please reach out on LinkedIn for now.",
      500
    );
  }

  if (!env.CONTACT_FORM_SHARED_TOKEN) {
    return errorResponse(
      request,
      "The contact form secret is not configured yet. Please reach out on LinkedIn for now.",
      500
    );
  }

  let submission;

  try {
    const rawSubmission = await readSubmission(request);
    submission = validateSubmission(rawSubmission);
  } catch (error) {
    return errorResponse(request, error.message || "Please review your submission.", 400);
  }

  let mailerResponse;

  try {
    mailerResponse = await env.CONTACT_MAILER.fetch(
      new Request("https://contact-mailer.internal/send", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-contact-form-token": env.CONTACT_FORM_SHARED_TOKEN
        },
        body: JSON.stringify(submission)
      })
    );
  } catch (error) {
    return errorResponse(
      request,
      "I could not reach the email service just now. Please try again shortly.",
      502
    );
  }

  let mailerResult = null;

  try {
    mailerResult = await mailerResponse.json();
  } catch (error) {
    mailerResult = null;
  }

  if (!mailerResponse.ok || !mailerResult || !mailerResult.ok) {
    return errorResponse(
      request,
      (mailerResult && mailerResult.error) ||
        "I could not send your message just now. Please try again or reach out on LinkedIn.",
      502
    );
  }

  return successResponse(request);
}
