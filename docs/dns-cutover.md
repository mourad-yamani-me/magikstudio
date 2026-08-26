# Cloudflare setup, step by step

Written for someone who has not used Cloudflare before. Moving `indiecore.net` from Blogger
to Cloudflare Pages **without interrupting your Zoho email**.

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

# Part 1 — Create the Pages project

**Pages** is Cloudflare's free static website hosting. You need an empty project for GitHub to
deploy into.

1. Go to **https://dash.cloudflare.com** and log in.
2. In the **left sidebar**, click **Workers & Pages**.
   *(Cloudflare renames this occasionally — in some accounts it sits under **Compute**. If you
   can't see it, use the dashboard search box at the top and type "Pages".)*
3. Click the blue **Create** button.
4. You'll see tabs at the top: **Workers** | **Pages**. Click **Pages**.
5. Look for **Upload assets** (*not* "Connect to Git"). Click it.

   > **Why not "Connect to Git"?** That would let Cloudflare build the site itself, skipping
   > the checks we built. We want GitHub Actions to build, verify, and run the Lighthouse
   > budget *first*, and only then upload. So Cloudflare just receives finished files.

6. **Project name** — type exactly:

   ```
   indie-core-dev
   ```

   This must match exactly; the GitHub workflow refers to it by name.

7. It asks for files. On your Mac, open the project folder and drag the **`dist`** folder in.
   (If `dist` doesn't exist, run `npm run build` first.)
8. Click **Deploy site**, then **Continue to project**.

You now have a live site at `https://indie-core-dev.pages.dev`. Your real domain is still on
Blogger — nothing has changed for visitors.

---

# Part 2 — Create an API token

This is the password GitHub uses to upload your site. We give it permission to do **one thing
only**, so that if it ever leaked, it could not touch your DNS or email.

1. Click your **profile icon**, top right → **My Profile**.
2. Left sidebar → **API Tokens**.
3. Click **Create Token**.
4. Scroll to the bottom → **Create Custom Token** → **Get started**.
5. Fill it in:

   **Token name:**
   ```
   github-actions-pages-deploy
   ```

   **Permissions** — three dropdowns side by side. Set them to:

   | Dropdown 1 | Dropdown 2 | Dropdown 3 |
   | --- | --- | --- |
   | `Account` | `Cloudflare Pages` | `Edit` |

   Add nothing else. One row is all it needs.

   **Account Resources:**

   | | |
   | --- | --- |
   | `Include` | your account |

   **TTL** (expiry): pick a year out. Put a reminder in your calendar to renew it.

6. **Continue to summary** → **Create Token**.
7. **Copy the token now.** It is shown once and never again. Paste it somewhere temporary.

> ⚠️ Do **not** use the "Global API Key" that Cloudflare also offers. That one can do anything
> on your account — including deleting your email records — and cannot be limited.

### Also grab your Account ID

Go back to **Workers & Pages**. On the right-hand side you'll see **Account ID** with a copy
button. Copy it.

---

# Part 3 — Give GitHub the token

1. Open your repo: **https://github.com/oettaib/indie-core-dev**
2. **Settings** (top row of the repo, far right) → left sidebar **Secrets and variables** →
   **Actions**.
3. Click **New repository secret**, twice:

   | Name | Secret |
   | --- | --- |
   | `CLOUDFLARE_API_TOKEN` | the token from Part 2 |
   | `CLOUDFLARE_ACCOUNT_ID` | your Account ID |

   Names must match exactly, capitals included.

4. Still in **Settings**, left sidebar → **Environments** → **New environment** → name it
   `production` → **Configure environment**.
   - Under **Deployment branches and tags**, choose **Selected branches and tags**, click
     **Add rule**, type `main`. This means only `main` can deploy to production.
5. **New environment** again → name it `preview` → save. No settings needed.

---

# Part 4 — First deploy

In your terminal:

```bash
cd ~/codes/Apps/indie-core-dev
git push -u origin main
```

Then open the **Actions** tab on GitHub. You'll see a run appear. Click it. Four boxes run in
order:

```
Build & verify  →  Lighthouse budget  →  Deploy production
```

Green ticks all the way = success. It takes about 3–5 minutes (Lighthouse is the slow one).

**If it fails**, click the failed box to read the log. The most common cause is a typo in a
secret name.

---

# Part 5 — Check the site before touching DNS 🔴

**This is the step that makes everything else safe.** Your domain still points at Blogger, so
you can test the new site with zero risk.

Open **https://indie-core-dev.pages.dev** and check:

- [ ] Home page loads; the phones float and the aurora moves
- [ ] Scrolling down reveals sections; screenshots rotate
- [ ] All 5 game pages open, screenshots enlarge when clicked
- [ ] All 5 privacy policies load and read correctly
- [ ] "Play free" buttons open the correct Google Play listings
- [ ] Open it on your phone — check the menu button works
- [ ] Visit `https://indie-core-dev.pages.dev/nonsense` → you get the 404 page

**Do not go further until every box is ticked.** Fix anything wrong now, while the live site
is untouched.

---

# Part 6 — Point the domain at the new site

Now we change those five website records. Cloudflare does it for you.

1. **Workers & Pages** → click **indie-core-dev** → **Custom domains** tab.
2. Click **Set up a custom domain**.
3. Type:
   ```
   www.indiecore.net
   ```
4. **Continue**. Cloudflare sees the domain is in your account and shows you the DNS change it
   wants to make — replacing the `www` record with one pointing at Pages.
5. Click **Activate domain**.
6. Repeat steps 2–5 for the bare domain:
   ```
   indiecore.net
   ```

**If it says a record conflicts**, it will name the record. Delete only that one:
- for `www` → the `CNAME www → ghs.google.com`
- for the bare domain → the four `A` records with IPs starting `216.239.`

> 🔴 If a screen ever offers to delete `MX` records or `TXT` records — **stop and say no.**
> Nothing in this process needs that.

Both entries should show **Active** within about 5 minutes. Occasionally it takes longer;
refresh the page.

---

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

1. **DNS → Records**, delete the `www` and bare-domain records pointing at `pages.dev`.
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
