# Gilbert Codex Firebase Project

Firebase project for the private Gilbert Codex product line.

## Project

- Project name: Gilbertcodex
- Project ID: gilbertcodex-40428
- Auth domain: gilbertcodex-40428.firebaseapp.com
- Storage bucket: gilbertcodex-40428.firebasestorage.app
- Storage URL: gs://gilbertcodex-40428.firebasestorage.app
- Web app ID: 1:811485840625:web:60e8af11cba2d70500d550
- Analytics measurement ID: G-0HBHNGNQDZ

## Local Source Files

- App config: `src/firebase/firebaseConfig.ts`
- Firebase runtime: `src/firebase/firebaseApp.ts`
- Firebase CLI config: `.firebaserc`, `firebase.json`
- Firestore rules: `firestore.rules`
- Storage rules: `storage.rules`

## Next Setup Steps

- Firestore rules were deployed successfully after console setup.
- Storage rules were deployed successfully after Storage setup.
- `npm.cmd run firebase:deploy:rules` deploys both Firestore and Storage rules together.
- Add Cloud Functions and Stripe secrets only after backend billing work begins.
- Keep App Check in monitor mode until auth and billing flows are verified.

## Secret Handling

The Firebase web config is client configuration, not a server secret. Do not commit service account JSON, Stripe secret keys, webhook signing secrets, or provider API keys.
