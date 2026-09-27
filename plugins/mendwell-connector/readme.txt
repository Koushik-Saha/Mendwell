=== Mendwell Connector ===
Contributors: mendwell
Tags: accessibility, seo, alt text, broken links, maintenance
Requires at least: 6.2
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 0.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Lets Mendwell apply the fixes you approve, undo them, and pause at any time.

== Description ==

Mendwell finds common accessibility, SEO and link issues on your site. This plugin is the only way it can change anything, and it can only:

* set image alt text (media library, block editor and classic editor images),
* set meta titles and descriptions (Yoast, Rank Math, SEOPress, or its own if you use none),
* repoint a broken link inside a post,
* undo any of those, but only if nobody has edited the content since,
* purge your page cache so the fix shows up.

It can't touch files, code, users, plugins, themes or settings. Every change is logged with its before and after value under Settings → Mendwell, where you can undo it or pause everything.

Every request from Mendwell is signed and time-limited, and can't be replayed. The shared secret is stored encrypted.

Mendwell fixes common issues and verifies each fix. It does not certify ADA/WCAG compliance.

== Changelog ==

= 0.1.0 =
* First release.
