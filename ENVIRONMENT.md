# Environment Variables Configuration

> Last updated: February 4, 2026

## Vercel Production Environment

All environment variables are configured and deployed to **https://agentic-coach-ux-next.vercel.app**

### OpenAI Configuration
| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | OpenAI API key for chat | *Required* |
| `OPENAI_CHAT_MODEL` | Chat completion model | `gpt-4o-mini` |

### OpenRouter Configuration
| Variable | Description | Default |
|----------|-------------|---------|
| `OPENROUTER_API_KEY` | OpenRouter API key for LLM endpoint | *Required* |
| `OPENROUTER_MODEL` | Model to use via OpenRouter | `openai/gpt-4o-mini` |
| `OPENROUTER_SITE_URL` | Referer header for OpenRouter | `http://localhost:3000` |
| `OPENROUTER_APP_NAME` | App name header for OpenRouter | `agentic-coach-ux-next` |

### MongoDB Configuration
| Variable | Description | Default |
|----------|-------------|---------|
| `MONGO_DB_CONNECTION_STRING` | MongoDB Atlas connection URI | *Required* |
| `MONGO_DB_NAME` | Database name | `coaching` |

## API Routes Using Environment Variables

| Route | Variables Used |
|-------|---------------|
| `/api/chat` | `OPENAI_API_KEY`, `OPENAI_CHAT_MODEL` |
| `/api/llm` | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_SITE_URL`, `OPENROUTER_APP_NAME` |
| `/api/sessions` | `MONGO_DB_CONNECTION_STRING`, `MONGO_DB_NAME` |
| `/api/sessions/[id]` | `MONGO_DB_CONNECTION_STRING`, `MONGO_DB_NAME` |

## Local Development

Copy `.env.example` to `.env` and fill in the required values:

```bash
cp .env.example .env
```

## MongoDB Atlas Network Access

> ⚠️ **IMPORTANT**: MongoDB Atlas requires IP whitelisting. Vercel serverless functions use dynamic IPs, so you must allow access from anywhere.

1. Go to [MongoDB Atlas](https://cloud.mongodb.com)
2. Select your cluster → **Network Access**
3. Click **Add IP Address**
4. Enter `0.0.0.0/0` (allow access from anywhere)
5. Click **Confirm**

This is required for Vercel serverless functions to connect to your database.

## Vercel CLI Commands

```bash
# List all environment variables
vercel env ls

# Add a new variable
echo "value" | vercel env add VARIABLE_NAME production

# Pull variables to local .env
vercel env pull
```
