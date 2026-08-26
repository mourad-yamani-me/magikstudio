# Cloudflare setup, step by step

Written for someone who has not used Cloudflare before. Moving `indiecore.net` from Blogger
to Cloudflare Workers **without interrupting your Zoho email**.

Total time: about an hour, most of it waiting and checking.

---

# Part 0 — Understand what you're changing

## What a DNS record is

DNS is your domain's address book. Each **record** answers one question about `indiecore.net`.
Different questions are answered by different record *types*:

| Type | Answers the question | Yours points to |
| --- | --- | --- |
| `A` | "What server hosts the website?" | Blogger's servers |
| `CNAME` | "This name is an alias for another name" | `www` → Blogger |
| `MX` | "Where do I deliver **email**?" | Zoho |
| `TXT` | "Notes" — used to prove ownership and sign email | Zoho + Google |

**The key point:** mail servers only ever read `MX` and `TXT`. Browsers only ever read
`A` and `CNAME`. They never look at each other's records.

So changing where your *website* points **cannot** break your *email*. The only way to break
email is to delete an `MX` or `TXT` record by hand.

**The safety rule: change records one at a time. Never use any "delete all" button.**

## Your actual records

I read your export. Here is every record you have, and what happens to it.

### ✅ Leave alone — these are your email (Zoho)

```
MX    indiecore.net              10  mx.zoho.eu
MX    indiecore.net              20  mx2.zoho.eu
MX    indiecore.net              50  mx3.zoho.eu
TXT   indiecore.net              "v=spf1 include:zohomail.eu ~all"
TXT   zmail._domainkey           "v=DKIM1; k=rsa; p=MIGfMA0GCSqG..."
```

The three `MX` records receive your mail. `SPF` and `DKIM` prove your mail is genuine so it
does not land in spam. **Do not touch these five records at any point.**

> You are on **Zoho EU** (`mx.zoho.eu`, `zohomail.eu`) — not Zoho.com. Most Zoho guides online
> assume `.com`. If any instruction tells you to set `mx.zoho.com`, it is the wrong region and
> **it would break your email.** Ignore it.

### ✅ Leave alone — these keep Google Search Console working

```
TXT   indiecore.net   "google-site-verification=6Op7HNbxo1JsRLQo4JYqEMxXzabAp6cZVERwk7CMQjM"
TXT   indiecore.net   "google-site-verification=2z9a0AelrPqRBzmrzouXeGumXQ6eeX5XlDxuW0gJz0Y"
```

### 🔄 These get replaced — the website records

```
A       indiecore.net   216.239.32.21
A       indiecore.net   216.239.34.21
A       indiecore.net   216.239.36.21
A       indiecore.net   216.239.38.21
CNAME   www             ghs.google.com
```

Those four IPs are Blogger. `ghs.google.com` is Google's hosting. **These five are the only
records that change.**

### ℹ️ Two oddities I found — neither affects this migration

**`go.indiecore.net` → `192.0.2.1`.** This is your Play Store short-link service
(`go.indiecore.net/0/pmn` → the Number Match listing). The `192.0.2.1` address is a deliberate
placeholder: it is never contacted, because the orange cloud makes Cloudflare answer the
request itself and a Redirect Rule sends the visitor to Google Play.

**This migration does not touch it.** We only change the bare domain and `www`. Your short
links keep working throughout, and afterwards.

**Two `NS` records pointing at `dns1/dns2.registrar-servers.com`.** Those are Namecheap's
nameservers, left over from before you moved to Cloudflare. I checked what the internet
actually sees, and it is only Cloudflare's (`gabriella` and `kipp`) — these two records are
inert and are being ignored. Harmless. You can delete them later; not part of this migration.

---

# Part 1 — Create the Worker  ✅ (already done)

**Terminology, because the dashboard is confusing here.** Cloudflare has two products that
host static sites: **Pages** (older) and **Workers** (current, more capable). Their new
dashboard puts the **Upload assets** button under **Workers**, so that is what you get.

You uploaded and got:

```
https://indie-core-dev.indiecode25.workers.dev
```

That is a **Worker**, and it is correct — keep it. `indie-core-dev.pages.dev` returned
`DNS_PROBE_FINISHED_NXDOMAIN` simply because no Pages project by that name exists; you never
made one. Nothing is broken.

Workers supports everything this site needs, verified live on your deployment:

| Feature | Status |
| --- | --- |
| All pages serve | ✅ 200 |
| `_redirects` (the Play Console privacy URLs) | ✅ 301 |
| `_headers` (cache + security headers) | ✅ applied |
| Custom 404 page | ✅ 404 |
| Custom domains | ✅ supported (requires Cloudflare-managed nameservers — yours are) |

The repo now contains `wrangler.jsonc` describing this Worker, so CI deploys to the exact
project you already created.

### If you ever need to recreate it

Dashboard → **Workers & Pages** → **Create** → **Workers** → **Upload assets**, name it
`indie-core-dev`, drag the `dist` folder, **Deploy**.

Or from the terminal, once you have the token from Part 2:

```bash
cd ~/codes/Apps/indie-core-dev
npm run build
npx wrangler deploy
```

# Part 1b — About that Settings page in the dashboard

You will see a **Settings** tab on the Worker with sections for Runtime, Build, General and so
on. Almost none of it should be touched by hand.

**The repository is the source of truth.** `wrangler.jsonc` describes this Worker, and every
deploy applies it. Anything you change by hand in the dashboard gets overwritten on the next
deploy — so a manual tweak looks like it works, then silently reverts.

| Dashboard section | What to do |
| --- | --- |
| **Runtime variables and secrets** | Nothing. Greyed out — a static-asset Worker has no code to read variables. |
| **Observability** (Logpush, Tail) | Nothing. Also unavailable for the same reason. |
| **Runtime → Compatibility date** | Nothing. Set from `wrangler.jsonc`. |
| **Runtime → Cache / Placement** | Leave at the defaults. Browser caching comes from `dist/_headers`; Cloudflare's edge caching for static assets is automatic. |
| **Build → Git repository** | 🔴 **Do not connect.** See below. |
| **Trigger events** | Nothing. Unavailable for static assets. |
| **General → Name** | Leave as `indie-core-dev`. It must match `wrangler.jsonc`. |
| **Domains** (separate tab) | This *is* used — in Part 6, to add your custom domain. |
| **Danger zone → Delete** | Obviously not. |

## 🔴 Do not connect a Git repository here

The **Build → Git repository** section offers GitHub and GitLab buttons. Connecting one turns
on **Workers Builds** — Cloudflare's own CI, which would build and deploy your site itself on
every push.

That is the same trap as "Connect to Git" when creating the project, and it is worse now,
because you would end up with **two systems deploying the same site**:

- GitHub Actions: builds → verifies links and metadata → runs the Lighthouse budget → deploys
- Workers Builds: builds → deploys, with **no checks at all**

They would race each other, and whichever finished last would win. A broken build that our
pipeline correctly refused to ship could get published anyway.

**Leave that section empty.** GitHub Actions pushes to Cloudflare; Cloudflare never pulls.

## A note on your other Worker

Your account also has a Worker called **`rough-queen-3dc2`** (visible in the sidebar's
Recents). That auto-generated name suggests it was created quickly — possibly the redirector
behind `go.indiecore.net`.

**Check what it does before deleting it.** Open it, look at its **Domains** tab, and see
whether `go.indiecore.net` is routed to it. If it is, leave it alone — that is your Play Store
short-link service. If it is genuinely unused, deleting it is harmless.

Either way it is unrelated to this migration.

---

# Part 2 — Create an API token

**What this is:** a password GitHub uses to upload your site to Cloudflare. You are going to
scope it so it can deploy Workers and nothing else — it will not be able to touch your DNS or
your Zoho email.

## 2.1 — Open the token page

1. Go to **https://dash.cloudflare.com**.
2. Click your **profile icon** in the very top-right corner.
3. Choose **My Profile**.
4. In the left sidebar of that page, click **API Tokens**.

Direct link if you prefer: **https://dash.cloudflare.com/profile/api-tokens**

## 2.2 — Use the Workers template

1. Click the blue **Create Token** button.
2. You now see a list of **templates**, each with a **Use template** button on the right.
3. Find the one called **“Edit Cloudflare Workers”** and click **Use template**.

> **Use the template. Do not build a custom token.** Deploying a Worker needs several
> permissions working together — Workers Scripts, plus read access to your account and user
> details. The template ticks exactly the right boxes. A hand-made token that is missing one
> of them fails later with an unhelpful "Authentication error", and it is genuinely hard to
> work out which one is absent.

> ⚠️ **If you already made a `Cloudflare Pages · Edit` token** following my earlier draft —
> it cannot deploy a Worker. Delete it and make this one instead.

## 2.3 — Fill in the form

The template has pre-filled the **Permissions** section. Leave it exactly as it is. Scroll to
the two sections below it:

**Account Resources**

| Dropdown 1 | Dropdown 2 |
| --- | --- |
| `Include` | your account |

**Zone Resources**

| Dropdown 1 | Dropdown 2 | Dropdown 3 |
| --- | --- | --- |
| `Include` | `Specific zone` | `indiecore.net` |

**Client IP Address Filtering** — leave empty. GitHub's runners have changing IPs.

**TTL** — click the date field and pick roughly a year from now. Add a calendar reminder to
renew it; deploys stop working silently on the day it expires.

## 2.4 — Create and copy it

1. **Continue to summary**. Read the one-line summary it shows you.
2. **Create Token**.
3. You now see the token — a long random string.

> 🔴 **Copy it now.** Cloudflare shows it exactly once and can never show it again. If you
> lose it you have to delete the token and make a new one.

Paste it somewhere temporary (a scratch note). You will paste it into GitHub in Part 3, then
delete your copy.

## 2.5 — Find your Account ID

1. Click **Cloudflare** logo top-left to go back, then **Workers & Pages** in the sidebar.
2. On the **right-hand side** of that page you'll see **Account ID** with a copy icon.
3. Copy it. It looks like `a1b2c3d4e5f6...` (32 hex characters).

## 2.6 — Test the token before going further ✅

This catches a wrong token in ten seconds instead of after a failed deploy.

```bash
cd ~/codes/Apps/indie-core-dev
export CLOUDFLARE_API_TOKEN=paste_your_token_here
npx wrangler whoami
```

**Good output** — it names your account and lists permissions including
`workers_scripts (edit)`:

```
Associated email: ...
Account Name: ...  Account ID: ...
Token Permissions: ... workers_scripts:edit ...
```

**Bad output** — `Authentication error` or `Unable to authenticate`: the token is wrong or
scoped incorrectly. Go back to 2.2 and make sure you used the **Edit Cloudflare Workers**
template.

While you're here, confirm it can actually deploy:

```bash
npm run build
npx wrangler deploy
```

If that succeeds, your token works and your site is republished. Now unset it so it does not
linger in your shell:

```bash
unset CLOUDFLARE_API_TOKEN
```

---

# Part 3 — Give the token to GitHub

## 3.1 — Add the two secrets

1. Open **https://github.com/oettaib/indie-core-dev**
2. Click **Settings** — top row of the repository, on the right. (If you don't see it, you're
   not looking at the repo's own settings; make sure you're on the repository page, not your
   profile.)
3. In the left sidebar: **Secrets and variables** → click it → choose **Actions**.
4. Click the green **New repository secret**.
5. First secret:
   - **Name:** `CLOUDFLARE_API_TOKEN`
   - **Secret:** the token from Part 2
   - **Add secret**
6. **New repository secret** again. Second secret:
   - **Name:** `CLOUDFLARE_ACCOUNT_ID`
   - **Secret:** the Account ID from step 2.5
   - **Add secret**

> Names must match **exactly**, capitals and underscores included. The workflow reads
> `secrets.CLOUDFLARE_API_TOKEN` — a lowercase or misspelled name silently becomes empty and
> the deploy fails with an authentication error.

You should now see both listed. GitHub never shows their values again — that is expected, and
it is why you kept a temporary copy.

Once both are saved, **delete your scratch note with the token in it.**

## 3.2 — Create the two environments

Environments let you require approval before production deploys and restrict which branch may
deploy.

1. Still in **Settings**, left sidebar → **Environments**.
2. **New environment** → name it exactly `production` → **Configure environment**.
3. Find **Deployment branches and tags**. Change the dropdown from *All branches* to
   **Selected branches and tags**.
4. Click **Add deployment branch or tag rule** → type `main` → **Add rule**.

   Now only `main` can ever deploy to production.

5. *(Optional)* Tick **Required reviewers** and add yourself. Every production deploy then
   waits for you to click Approve. Useful if you want a final gate; skip it if you want
   pushes to `main` to just ship.

6. Go back to **Environments** → **New environment** → name it `preview` → **Configure
   environment** → no settings needed, just leave it.

---

# Part 4 — First automated deploy

Everything is wired. Push the code.

```bash
cd ~/codes/Apps/indie-core-dev
git push -u origin main
```

## 4.1 — Watch it run

1. Open **https://github.com/oettaib/indie-core-dev/actions**
2. A run named after your commit appears, with a yellow dot (in progress).
3. Click it. You'll see four boxes connected in sequence:

```
Build & verify  →  Lighthouse budget  →  Deploy production
```

Click any box to watch its live log.

**Timing:** Build & verify ~1 minute. Lighthouse budget ~3–5 minutes (it audits three pages).
Deploy ~30 seconds.

If you enabled required reviewers in 3.2, the run pauses before *Deploy production* with a
**Review deployments** button. Click it → tick `production` → **Approve and deploy**.

## 4.2 — What each box is doing

| Box | What it checks |
| --- | --- |
| **Build & verify** | Generates the site, then fails on dead links, missing images, bad page metadata, broken redirects, or leftover placeholder text |
| **Lighthouse budget** | Fails if performance drops below 95, or accessibility / best-practices / SEO below 100 |
| **Deploy production** | Uploads `dist` to your Worker |

The deploy job **needs** both gates. A failing check means nothing ships.

## 4.3 — Confirm it worked

Green ticks on all boxes. Then check the site updated:

```bash
curl -sI https://indie-core-dev.indiecode25.workers.dev/ | head -1
```

Expect `HTTP/2 200`.

## 4.4 — If it fails

Click the red box and read the log; the failing step is expanded automatically.

| Message | Cause |
| --- | --- |
| `Authentication error` / `Unable to authenticate` | Token wrong, expired, or built without the Workers template. Redo Part 2. |
| `workers.api.error.script_not_found` | The Worker name in `wrangler.jsonc` doesn't match the one in your dashboard. |
| `ERROR dead internal link → /...` | A real broken link in the site. Fix it and push again. |
| `FAILED: /... performance 91 < 95` | A change made the site slower. |
| Lighthouse step times out | Occasionally flaky on shared runners — click **Re-run failed jobs**. |

---

# Part 5 — Check the site before touching DNS 🔴

**This is the step that makes everything else safe.** Your domain still points at Blogger, so
you can test the new site with zero risk.

Open **https://indie-core-dev.indiecode25.workers.dev** and check:

- [ ] Home page loads; the phones float and the aurora moves
- [ ] Scrolling down reveals sections; screenshots rotate
- [ ] All 5 game pages open, screenshots enlarge when clicked
- [ ] All 5 privacy policies load and read correctly
- [ ] "Play free" buttons open the correct Google Play listings
- [ ] Open it on your phone — check the menu button works
- [ ] Visit `https://indie-core-dev.indiecode25.workers.dev/nonsense` → you get the 404 page

**Do not go further until every box is ticked.** Fix anything wrong now, while the live site
is untouched.

---

# Part 6 — Point the domain at the new site

Now the five website records change. Cloudflare does it for you.

1. **Workers & Pages** → click **indie-core-dev**.
2. **Settings** tab → **Domains & Routes**.
3. Click **Add** → **Custom Domain**.
4. Enter:
   ```
   www.indiecore.net
   ```
5. Click **Add domain**. Cloudflare updates DNS itself and issues the TLS certificate.
6. Repeat steps 3–5 for the bare domain:
   ```
   indiecore.net
   ```

**If it reports a conflicting record**, it names the offender. Delete only that one:
- for `www` → `CNAME www → ghs.google.com`
- for the bare domain → the four `A` records starting `216.239.`

> 🔴 If any screen offers to remove `MX` or `TXT` records — **say no**. Nothing here needs
> that. Those are your Zoho email.

Both entries show **Active** within a few minutes. The certificate can take up to 15 minutes;
until then you may briefly see a TLS warning. That is normal.

# Part 7 — Check your email still works 🔴

**Do this immediately.** In your terminal:

```bash
dig +short MX indiecore.net
```
Expected — exactly this:
```
10 mx.zoho.eu.
20 mx2.zoho.eu.
50 mx3.zoho.eu.
```

```bash
dig +short TXT indiecore.net | grep spf
```
Expected:
```
"v=spf1 include:zohomail.eu ~all"
```

```bash
dig +short TXT zmail._domainkey.indiecore.net
```
Expected: a long `v=DKIM1; k=rsa; p=...` string.

Then a real-world test, which matters more than any command:

1. From `contact@indiecore.net`, send an email to your personal address (Gmail etc.)
2. Reply to it from that personal address
3. Confirm the reply arrives in Zoho

**If something is missing:** go to **DNS → Records → Add record** and re-enter it from the
export at the top of this document. Email is not lost in the meantime — sending servers retry
for several days.

---

# Part 8 — Check the privacy policy links 🔴

These URLs are registered in your Google Play Console listings. If they break, your store
listings link to dead pages.

```bash
for u in soda-jam-color-sort gridsmash-block logo-quiz-guess-brand \
         perfectmatch-numbers word-slot; do
  printf '%-26s %s\n' "$u" \
    "$(curl -sI "https://www.indiecore.net/p/privacy-policy-for-$u.html" | head -1)"
done
```

Every line must say **`HTTP/2 301`**. That is the redirect sending old links to the new pages.

Check one lands correctly:

```bash
curl -sIL https://www.indiecore.net/p/privacy-policy-for-word-slot.html | grep -iE 'HTTP|location'
```
You want a `301`, a `location:` of `/privacy/word-slot/`, then a `200`.

---

# Part 9 — Send the bare domain to www

Your site's official address is `www.indiecore.net`. Make `indiecore.net` forward to it.

1. In the dashboard, click **indiecore.net** (from Account Home).
2. Left sidebar → **Rules** → **Redirect Rules**.
3. **Create rule**.
4. Fill in:

   **Rule name:** `apex to www`

   **When incoming requests match** → choose **Custom filter expression**, then:

   | Field | Operator | Value |
   | --- | --- | --- |
   | `Hostname` | `equals` | `indiecore.net` |

   **Then** → **Dynamic redirect**

   **Expression** — paste exactly:
   ```
   concat("https://www.indiecore.net", http.request.uri.path)
   ```

   **Status code:** `301`
   **Preserve query string:** on

5. **Deploy**.

Test:
```bash
curl -sI https://indiecore.net/games/word-slot/ | grep -iE 'HTTP|location'
```
Expect `301` and `location: https://www.indiecore.net/games/word-slot/`.

---

# Part 10 — Turn off Blogger

**Only once Parts 7, 8 and 9 all pass.**

1. Open **Blogger → Settings → Publishing → Custom domain**.
2. Remove `www.indiecore.net`.

Your blog reverts to its `.blogspot.com` address. **Your posts are not deleted.** Traffic
already goes to Cloudflare, so nothing changes for visitors.

3. In Cloudflare **DNS → Records**, you may see a leftover `CNAME` with a random-looking name
   pointing at `gv-....dv.googlehosted.com`. That was Blogger's ownership check. It is now
   dead — delete it. (If you don't see one, fine.)

---

# Part 11 — Tell Google about the new site

Your two `google-site-verification` records are untouched, so your Search Console property is
still verified.

1. Open **https://search.google.com/search-console** → select `indiecore.net`.
2. Left sidebar → **Sitemaps**. Under "Add a new sitemap" enter:
   ```
   sitemap.xml
   ```
   → **Submit**.
3. Top search bar → paste `https://www.indiecore.net/` → **Request indexing**.

Because old URLs `301` to new ones, Google transfers your existing ranking. Expect a few weeks
for the index to fully update.

---

# If something goes wrong — rollback

Getting Blogger back takes about five minutes.

1. **DNS → Records**, delete the `www` and bare-domain records pointing at `workers.dev`.
2. **Add record** five times, exactly:

   | Type | Name | Value |
   | --- | --- | --- |
   | A | `@` | `216.239.32.21` |
   | A | `@` | `216.239.34.21` |
   | A | `@` | `216.239.36.21` |
   | A | `@` | `216.239.38.21` |
   | CNAME | `www` | `ghs.google.com` |

   Leave the orange cloud **on** (proxied) for all five.
3. Re-add the custom domain in **Blogger → Settings → Publishing**.

Your email is untouched by any of this, in either direction.

---

# Optional — protect your domain from spoofing

You have `SPF` and `DKIM` but **no `DMARC` record**. Without it, someone can more easily send
email pretending to be `@indiecore.net`. Adding one in report-only mode is completely safe —
it never blocks mail.

**DNS → Records → Add record:**

| Field | Value |
| --- | --- |
| Type | `TXT` |
| Name | `_dmarc` |
| Content | `v=DMARC1; p=none; rua=mailto:contact@indiecore.net` |

`p=none` means "watch and report, change nothing". Leave it a few weeks, then consider
`p=quarantine`.

---

# From now on

You never touch Cloudflare again for day-to-day changes:

```bash
git switch main && git pull
git switch -c content/whatever-you-are-changing
# make your edits
npm run check          # build + verify locally
git push -u origin content/whatever-you-are-changing
```

Open a pull request on GitHub. A preview link gets posted on it. Merge when happy — production
updates itself.
