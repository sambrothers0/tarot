*Last updated: 1 November 2026*

Tarot is a free, personal project run by Sam Brothers ("I", "me"). This policy
explains what Tarot collects, why, and what you can do about it.

## The short version

- **Your Minecraft save never leaves your computer.** Scanning happens entirely
  inside your browser tab. No save file, file name, folder path or scan result
  is uploaded as part of a scan.
- **An account is optional.** You can use every scanning feature without
  signing in.
- **If you sign in with Google**, Tarot stores your Google account ID, email
  address, name and profile picture URL. That's it.
- **Nothing is sold, shared for advertising, or used to track you.** There are
  no analytics, ads or tracking cookies.

## Scanning

When you pick a save (a zip or a world folder), the browser reads it locally
and the scan runs on your own machine. Tarot has no server in that path, so the
contents of your world, its file names and the coordinates it finds are never
sent anywhere.

## Signing in with Google

Sign-in uses Google Identity Services. When you sign in, Google sends Tarot a
signed token confirming who you are, and Tarot keeps the following from it:

- your Google account ID (a stable identifier Google assigns),
- your email address,
- your name, and
- the URL of your Google profile picture.

Tarot also records when your account was created and when you last signed in.
It does not request access to your Google Drive, contacts, calendar or any
other Google data.

This information is used only to recognise you when you come back and to show
you who you are signed in as. It is not used for marketing and is not shared
with anyone except the service providers listed below, who host it.

### Sessions

After you sign in, your browser keeps a random session token in local storage
so you stay signed in. The server stores only a one-way hash of that token,
never the token itself. Sessions expire after 30 days, and signing out revokes
the session immediately. Tarot does not use cookies.

## Saved scans

If you choose to save a scan to your account, Tarot stores the block type,
dimension, the save's name and the coordinates found, so you can view them
later. This only happens when you press Save while signed in; nothing is saved
automatically.

## Service providers

Tarot relies on a few providers to run:

- **GitHub Pages** hosts the website itself.
- **Google Cloud Run** hosts the accounts API.
- **Neon** hosts the database that holds account data.
- **Google** provides sign-in.

Like most web hosts, these providers may keep standard request logs (such as
IP address, browser type and time of request) for security and operations,
under their own privacy policies.

## Keeping and deleting your data

Your account data is kept until you delete your account. You can do that at any
time from the account menu with **Delete account**, which permanently removes
your account, your sessions and anything saved to it.

You can also revoke Tarot's access to your Google account at any time from your
[Google Account permissions](https://myaccount.google.com/permissions).

## Children

Tarot is not directed at children under 13, and I do not knowingly collect
personal information from them. If you believe a child has created an account,
contact me and I will delete it.

## Changes

If this policy changes, the updated version will be posted here with a new
"Last updated" date.

## Contact

Questions or requests about your data can be sent by opening an issue on
[GitHub](https://github.com/sambrothers0/tarot/issues).
