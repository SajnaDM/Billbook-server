BILL BOOK — FREE HOSTING & PRIVACY GUIDE
==========================================

This version costs nothing to run: a free web server (Render) plus a
free, always-persistent database (Turso). Every device — any
computer or phone with a browser — sees the same live data, and each
person's login remembers exactly which screen they were last on.

ABOUT PRIVACY — WHO CAN GET IN
Nobody can access any data without a valid username and password
that YOU create. It doesn't matter who else can technically reach
the web address — without a login, all they see is a sign-in
screen. Practical steps to keep this to just your one company:
  - Only give the web address and login details to people at that
    company. Don't post the address publicly anywhere.
  - You (or whoever sets it up first) become the ADMIN. Only the
    admin can create new logins — so no one can let themselves in.
  - Consider changing the JWT_SECRET value (step 4 below) to
    something long and random that only you know.
This is the same level of privacy as any normal business login
page (e.g. an online banking portal) — the address can technically
be visited by anyone, but nobody gets past the login without
credentials you control.

STEP 1 — SET UP A FREE DATABASE (Turso)
1. Go to turso.tech and sign up for a free account.
2. Create a new database (any name, e.g. "billbook").
3. From its dashboard, find and copy two values:
     - the Database URL (starts with libsql://)
     - an Auth Token (you may need to click "Create Token")
   Keep both safe — you'll paste them in Step 4.

STEP 2 — TEST LOCALLY FIRST (optional but recommended)
Install Node.js from nodejs.org (the "LTS" version) if you don't
have it. Then, in a terminal, inside this folder, run:

  npm install
  npm start

This runs against a local file automatically (no Turso needed yet)
so you can open http://localhost:3000 and try it out.
Press Ctrl+C to stop it when you're done testing.

STEP 3 — CREATE A FREE WEB SERVICE (Render)
1. Go to render.com and sign up (no card required for this tier).
2. Put this project's code somewhere Render can reach it — the
   simplest way is to create a free GitHub account, create a new
   repository, and upload this folder's contents to it.
3. In Render, click "New" > "Web Service" and connect that
   repository.
4. Set:
     Build Command: npm install
     Start Command: npm start
     Instance Type: Free

STEP 4 — CONNECT THE DATABASE AND SECURE IT
In Render, open your new service > Environment, and add these
three environment variables:
     TURSO_DATABASE_URL   = (the libsql:// URL from Step 1)
     TURSO_AUTH_TOKEN     = (the auth token from Step 1)
     JWT_SECRET            = (any long random string you make up)
Save — Render will redeploy automatically.

STEP 5 — GO LIVE
Render gives you a web address like:
     https://your-app-name.onrender.com
Open it. The first person to visit creates the ADMIN account.
The admin then goes to Settings > Team access to create logins
for everyone else at the company (staff accounts can't reach
Settings, so company details and account management stay admin-only).

A NOTE ON SPEED
Render's free tier "sleeps" the app after 15 minutes of no use, so
the very first visit after a quiet period can take 30–60 seconds to
wake up. After that it's fast again. Your data is completely safe
during sleep — it lives in Turso, not in Render, so nothing is ever
lost, and there's no charge either way.

BACKUPS
Go to Settings > Download backup occasionally and keep that file
somewhere safe, just in case.

QUESTIONS
This is custom-built software with no vendor support line — keep
this folder, your Turso credentials, and your JWT_SECRET safe.
