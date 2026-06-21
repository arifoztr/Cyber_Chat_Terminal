Must-follow constraints

Zero-Knowledge Backend: The Node.js server (server.js) acts only as a signaling and relay server. You MUST NOT write backend logic to parse, decrypt, inspect, or log textPayload or filePayload.

Client-Side Storage Strictness: Chat history (cyber_history_), contacts (cyber_contacts_), and derived ECDH secrets MUST remain exclusively in the browser's localStorage. Never transmit these keys or histories to the server.

Native Web Crypto: All client-side encryption/decryption MUST use the native window.crypto.subtle API. Do not introduce external cryptography packages (e.g., crypto-js).

Vanilla Frontend Ecosystem: The client (siber_e2ee_sohbet_terminali.html) is a single HTML file using vanilla JavaScript and Tailwind CSS via CDN. DO NOT introduce frontend frameworks (React/Vue/Svelte) or build steps/bundlers.

Repo-specific conventions

Synchronous JSON Commits: The current backend database is a raw database.json file. Any mutation to the db object (e.g., db.users, db.queue) in server.js MUST be immediately followed by a saveDatabase() call (debounced ~50ms); use saveDatabaseImmediate() only for shutdown/critical-path flushes.

Agent ID Format: System-generated user IDs must strictly follow the AGN-XXXX-XXXX format.

Bilingual & Thematic Separation: - Code architecture (variables, functions, API events) MUST be in English.

User-facing UI text MUST be in Turkish.

UI additions must strictly adhere to the established "cyber" aesthetic (Tailwind neon colors, monospace fonts, uppercase text, glitch effects).

Change safety rules & Known gotchas

Revoke Protocol Fragility: The message revoke feature (revoke_packet) relies on exact schema matching. If you modify message packet structures, you MUST preserve packetId, senderId, and targetId. You MUST also verify that the frontend DOM removal logic (document.getElementById('msg-'+packetId)) and the backend db.queue filter remain intact.

Global State vs. UI Sync: The frontend relies entirely on global state variables (myContacts, activeTarget, derivedSecrets, unreadCounts). Mutating these variables does not automatically update the DOM. You MUST manually trigger respective UI render functions (e.g., renderContactsSidebar(), enableChatUI()) after state mutations.

Offline Queue Overwrites: When pushing to db.queue[targetId] in server.js, always verify the array exists first (if (!db.queue[targetId]) db.queue[targetId] = [];) to prevent overwriting pending messages.