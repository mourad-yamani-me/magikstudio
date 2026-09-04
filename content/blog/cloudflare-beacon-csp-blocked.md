---
title: Cloudflare injects a beacon. My CSP said no.
date: 2026-09-01
description: A CSP error in production, from a script I never added. The usual fix is to allow the host — which would have made my privacy policy false.
tags: [cloudflare, security, privacy, performance]
code: https://gist.github.com/IndieCoreDev/6c707bf89e5d215225f3bdac6e4a4b25
codeLabel: The verifier, including the CSP guard
devto: true
linkedin: false
draft: false
---

I deployed, opened the console on the live site out of habit, and found this:

```
Loading the script 'https://static.cloudflareinsights.com/beacon.min.js/v3d52…'
violates the following Content Security Policy directive: "script-src 'self'
'unsafe-inline' 'inline-speculation-rules'". The action has been blocked.
```

I had not added that script. It is in no template, no build output, and no dependency.
`grep -c cloudflareinsights dist/index.html` returns 0.

## It is not in the page you build

Cloudflare Web Analytics has an automatic mode, on by default when a site is added, that
injects `beacon.min.js` into HTML responses at the edge. Your origin never sees it. Your
repository never contains it.

It also does not inject for everything. I fetched the same URL with curl, then again with a
full desktop browser User-Agent, and neither response carried the script. Only a real browser
navigation gets it, which is why Lighthouse saw it and my terminal did not.

That combination is worth sitting with for a second. The artefact exists in production, is
absent from your source, and cannot be reproduced with the tool most of us reach for first
when we want to see what a server actually returned.

## Nothing was tracked

The CSP did its job. From the Lighthouse network trace:

```
url:          https://static.cloudflareinsights.com/beacon.min.js/v3d52…
resourceType: Script
statusCode:   -1
transferSize: 0
```

Status −1 with zero bytes transferred means the request never started. The browser matched
the URL against `script-src`, found no permitted source, and refused before opening a
connection. No data left anyone's browser.

So the console error is the sound of a guard working. It still costs something: a logged
error drops the Best Practices category from 100 to 92, and a red line in the console trains
you to ignore red lines in the console.

## The fix everyone reaches for is the wrong one here

Search the error and the common answer is to add `https://static.cloudflareinsights.com` to
`script-src`. That clears the console, restores the score, and takes about ten seconds.

My privacy policy says this:

> There is no Google Analytics, no Plausible, no Matomo — no analytics script of any kind
> runs in your browser, and no request leaves this domain unless you start a trailer.

Allowing the host would load the beacon. The sentence above would become false in the same
edit that turned the console green, and nothing in my build would have objected, because the
policy is prose and the CSP is a header and until last week nothing connected them.

The fix that matches what I wrote is in the Cloudflare dashboard, not the repository:
**Web Analytics → the site → Manage Site → Disable**. That stops the injection. The console
goes quiet because the script is gone, rather than because it was invited in.

## The check I added instead

A promise enforced by one directive that nothing watches is a promise waiting to be broken by
someone tidying up a CSP six months from now. So the build now asserts the connection:

```js
const claimsNoAnalytics = /no analytics script of any kind/i.test(policy);

if (claimsNoAnalytics) for (const directive of ['script-src', 'connect-src']) {
  const found = csp.match(new RegExp(directive + ' ([^;]+);'));
  const hosts = found[1].trim().split(/\s+/).filter(t => /^https?:/.test(t) || t === '*');
  if (hosts.length)
    fail('_headers', `${directive} allows ${hosts.join(', ')} — /privacy/ promises no `
      + `analytics script and no request off this domain`);
}
```

`frame-src` is deliberately excluded. The YouTube embed behind the gameplay trailers is the
one exception the policy names, in its own section, so allowing that host is consistent with
the document rather than a hole in it.

I verified the check by adding the beacon host and watching the build fail. A check I have
never seen fail is not something I would call a check.

## What this changed about how I verify a deploy

My CI runs Lighthouse against a local static server. That server is the built `dist/`
directory and nothing else — no Cloudflare, no edge features, no injected anything. Every
audit passes at 100, and every one of those hundreds is honest about the thing it measured.

It measured a directory. Production is a directory plus a CDN with its own opinions.

I now run one audit against the real hostname after a deploy, and read the console. It takes
a minute. It found a tracker I had not agreed to, on a site whose entire pitch is that it
does not have one.

There is a second thing in those response headers I have not resolved yet, noted here so I
do not quietly forget it:

```
nel:       {"report_to":"cf-nel","success_fraction":0.0,"max_age":604800}
report-to: {"group":"cf-nel","endpoints":[{"url":"https://a.nel.cloudflare.com/report/v4…"}]}
```

Network Error Logging. No script executes, so "no analytics script runs in your browser"
holds. But a failed request would send a report to Cloudflare, and my policy also says no
request leaves this domain unless you start a trailer. Headers are not covered by CSP, so
nothing I can put in the repository will stop it.
