# API regression checks

Requires Node 22.18+ (or Node 24) and installed dependencies.

```sh
npm test
npm run build
npm run test:api-integration
```

The integration suite starts the production build on an ephemeral loopback port with synthetic credentials. Model responses are mocked, external HTTP requests are blocked, and no MongoDB, email or voice credentials are inherited. It tests all 51 supplied routing cases through HTTP, malformed input, payload limits, authentication, response headers, recipient checks, and a deliberately wrong model schedule corrected by the server. The date tests must run against the build as well as the TypeScript helpers: a minifier issue in the original build broke the interpolated relative-date regex.

The mock is only loaded into the child test process, never by application code. A successful run does not prove live model quality, database persistence, email delivery or voice connectivity. Run preview UAT after an approved deployment.

Request limits: 10,000 characters per message/prompt/string field, 100 messages, 50,000 message characters total, and 256 KiB of raw JSON. Invalid shapes return JSON 400; exceeded limits return JSON 413. Authentication is checked first. Session message validation also applies to PATCH.

Date grounding accepts an explicit ordered date list (`dates: tomorrow, within the next 24 hours, next Friday`) or a global deadline (`action plan by next Friday`). It resolves those phrases in Europe/London, corrects the rendered focus bullets and uses those bullets as the structured plan source when all dates are known. Unrelated narrative dates and ambiguous mismatched lists are left untouched rather than assigned to arbitrary actions.

The CSP retains inline scripts for static Next.js hydration and inline styles. It blocks objects and framing, restricts resources by origin, and permits ElevenLabs/LiveKit connections. It is not a nonce-based XSS policy. Voice connectivity must be checked on an approved preview with its real provider configuration.
