# Cloudflare Contact Form Setup

This project is now wired for a Cloudflare Pages -> Service Binding -> Worker -> Email Routing flow.

## What Was Added

- `functions/api/contact.js`
  - Receives the form submission from your Pages site.
  - Validates the fields.
  - Forwards the submission to an internal mailer Worker through a service binding.
- `contact-mailer-worker/src/index.js`
  - Builds the outgoing email.
  - Sends it with Cloudflare Email Routing's `send_email` binding.
- `contact-mailer-worker/wrangler.jsonc`
  - Starter Wrangler config for the mailer Worker.

## What You Still Need To Configure

### 1. Enable Email Routing

In Cloudflare:

1. Open your domain.
2. Go to `Email` or `Email Routing`.
3. Enable Email Routing.
4. Verify the inbox where you want to receive form submissions.

### 2. Choose a sender address on your domain

Pick an address on the same domain where Email Routing is enabled, for example:

- `website-contact@your-domain.com`

Update that value in:

- `contact-mailer-worker/wrangler.jsonc`

### 3. Set the final destination inbox

In `contact-mailer-worker/wrangler.jsonc`, replace:

- `replace-with-your-verified-inbox@example.com`

with the verified inbox that should receive submissions.

### 4. Add a shared secret to the Worker

In the `contact-mailer-worker` directory, set a secret:

```bash
wrangler secret put CONTACT_FORM_SHARED_TOKEN
```

Use a long random string.

### 5. Deploy the mailer Worker

From the `contact-mailer-worker` directory:

```bash
wrangler deploy
```

That deploy creates the Worker named in `contact-mailer-worker/wrangler.jsonc`.

### 6. Add the same secret to your Pages project

In your Cloudflare Pages project:

1. Go to `Settings`.
2. Open `Variables and Secrets`.
3. Add a secret named `CONTACT_FORM_SHARED_TOKEN`.
4. Paste the exact same value you used for the Worker.

### 7. Add the Service Binding to Pages

In your Cloudflare Pages project:

1. Go to `Settings`.
2. Open `Bindings`.
3. Add a `Service binding`.
4. Use the variable name:
   - `CONTACT_MAILER`
5. Point it at your deployed Worker:
   - `aamir-consulting-contact-mailer`
   - or whatever Worker name you choose

Redeploy the Pages project after adding the binding.

## Local Development

Run the Worker in one terminal from `contact-mailer-worker`:

```bash
wrangler dev
```

Run the Pages project in another terminal from the project root:

```bash
wrangler pages dev . --service CONTACT_MAILER=aamir-consulting-contact-mailer
```

If you renamed the Worker, use that Worker name instead.

## Notes

- The form endpoint is `/api/contact`.
- The frontend now submits with JavaScript and shows a success or error message inline.
- Non-JavaScript form submissions still work through normal `POST` requests and redirect back to `#contact`.
- Pages Functions do not support `send_email` directly, which is why the mailer Worker exists as a separate service.
