# CareerPredictor

A web application that analyzes LinkedIn profiles and finds similar professionals who have achieved specific career goals. The app uses Exa's web crawler to scrape profiles, Clado's AI-powered search to find matching professionals, and Cloudflare Workers AI to extract career criteria.

## Architecture

- **Frontend**: React + Vite + TypeScript
- **Backend**: Cloudflare Worker
- **APIs**: Exa (profile scraping), Clado (people search), Cloudflare Workers AI

## Project Structure

```
CareerPredictor/
├── frontend/           # React frontend application
│   ├── src/
│   │   ├── App.tsx    # Main application component
│   │   ├── App.css    # Styles
│   │   └── main.tsx   # Entry point
│   └── vite.config.ts # Vite configuration with API proxy
├── worker/            # Cloudflare Worker backend
│   ├── src/
│   │   └── index.ts   # Worker implementation
│   └── wrangler.toml  # Worker configuration
└── CLAUDE.md          # Development guidance
```

## Setup

### Prerequisites

- Node.js 18+
- npm or yarn
- Cloudflare account (for deployment)
- Exa API key from https://dashboard.exa.ai/ (for profile scraping)
- Clado API key from https://docs.clado.ai/ (for people search)

### Frontend Setup

```bash
cd frontend
npm install
cp .env.example .env  # Configure if needed
```

### Worker Setup

```bash
cd worker
npm install
cp .dev.vars.example .dev.vars
# Edit .dev.vars and add your EXA_API_KEY and CLADO_API_KEY
```

## Development

### Run the Worker (in one terminal)

```bash
cd worker
npm run dev
```

The worker will start on `http://localhost:8787`

### Run the Frontend (in another terminal)

```bash
cd frontend
npm run dev
```

The frontend will start on `http://localhost:5173`

## Deployment

### Deploy the Worker

1. Install Wrangler CLI globally (if not already installed):
```bash
npm install -g wrangler
```

2. Login to Cloudflare:
```bash
wrangler login
```

3. Deploy the worker:
```bash
cd worker
npm run deploy
```

4. Set the environment variables in Cloudflare dashboard or via CLI:
   ```bash
   wrangler secret put EXA_API_KEY
   wrangler secret put CLADO_API_KEY
   ```
   Or manually in Cloudflare dashboard:
   - Go to Workers & Pages > your-worker > Settings > Variables
   - Add `EXA_API_KEY` and `CLADO_API_KEY` as encrypted secrets

### Deploy the Frontend

The frontend can be deployed to Cloudflare Pages:

1. Build the frontend:
```bash
cd frontend
npm run build
```

2. Deploy to Cloudflare Pages:
```bash
npx wrangler pages deploy dist --project-name career-predictor
```

3. Configure the environment variable:
   - In Cloudflare Pages settings, add `VITE_API_URL` with your deployed worker URL

Alternatively, deploy to any static hosting service (Vercel, Netlify, etc.)

## How It Works

1. User enters a LinkedIn profile URL and a career goal
2. The frontend sends a request to the Cloudflare Worker
3. The worker:
   - Calls Exa's crawler API to get the LinkedIn profile as markdown
   - Uses Cloudflare Workers AI to extract career criteria (alma mater, companies, skills, etc.)
   - Queries Clado's AI-powered search API to find similar professionals matching those criteria
4. Results are displayed to the user with rich profile information

## Privacy

All data is processed in-memory and never stored or persisted. No user data is saved to databases or logs.

## API Keys

- **Exa API Key**: Required for crawling/scraping LinkedIn profiles
  - Get it from: https://dashboard.exa.ai/
- **Clado API Key**: Required for searching and finding matching professionals
  - Get it from: https://docs.clado.ai/
  - Use natural language queries to find LinkedIn profiles
- **Cloudflare Workers AI**: Automatically available when deployed to Cloudflare Workers
  - No separate API key needed, uses Workers AI binding

## Testing

To test the application:

1. Start both the worker and frontend in development mode
2. Enter a LinkedIn profile URL (e.g., `https://www.linkedin.com/in/example`)
3. Enter a career goal (e.g., "working at a FAANG company")
4. Click "Find Similar Professionals"
5. View the extracted criteria and matched profiles

## License

ISC
