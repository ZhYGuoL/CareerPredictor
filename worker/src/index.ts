interface Env {
  AI: any
  EXA_API_KEY: string
}

interface CareerCriteria {
  almaMater?: string
  year?: string
  age?: string
  previousCompanies?: string[]
  skills?: string[]
  [key: string]: string | string[] | undefined
}

interface MatchedProfile {
  url: string
  title: string
  snippet: string
}

// CORS headers for frontend communication
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders })
    }

    try {
      const { linkedinUrl, careerGoal } = await request.json() as { linkedinUrl: string; careerGoal: string }

      if (!linkedinUrl || !careerGoal) {
        return new Response(
          JSON.stringify({ error: 'Missing linkedinUrl or careerGoal' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Step 1: Crawl LinkedIn profile using Exa
      console.log('Crawling LinkedIn profile...')
      const markdown = await crawlLinkedInProfile(linkedinUrl, env.EXA_API_KEY)

      // Step 2: Extract career criteria using Cloudflare Workers AI
      console.log('Extracting career criteria...')
      const criteria = await extractCriteria(markdown, env.AI)

      // Step 3: Query Exa webset for matching profiles
      console.log('Finding matching profiles...')
      const matchedProfiles = await findMatchingProfiles(criteria, careerGoal, env.EXA_API_KEY)

      return new Response(
        JSON.stringify({ criteria, matchedProfiles }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    } catch (error) {
      console.error('Error processing request:', error)
      return new Response(
        JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
  },
}

async function crawlLinkedInProfile(url: string, apiKey: string): Promise<string> {
  const response = await fetch('https://api.exa.ai/contents', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      ids: [url],
      text: {
        includeHtmlTags: false,
        maxCharacters: 10000,
      },
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Exa API error: ${response.status} - ${errorText}`)
  }

  const data = await response.json() as { results: Array<{ text?: string }> }

  if (!data.results || data.results.length === 0 || !data.results[0].text) {
    throw new Error('Failed to crawl LinkedIn profile')
  }

  return data.results[0].text
}

async function extractCriteria(markdown: string, ai: any): Promise<CareerCriteria> {
  const prompt = `You are a career profile analyzer. Extract the following information from this LinkedIn profile in JSON format:
- almaMater: The university or college they attended
- year: Graduation year or current year in school
- age: Approximate age (if mentioned or can be inferred)
- previousCompanies: Array of companies they've worked at
- skills: Array of key skills mentioned

Profile text:
${markdown.substring(0, 4000)}

Respond ONLY with valid JSON in this format:
{
  "almaMater": "string",
  "year": "string",
  "age": "string",
  "previousCompanies": ["string"],
  "skills": ["string"]
}

If any field is not found, use an empty string or empty array.`

  const response = await ai.run('@cf/meta/llama-3-8b-instruct', {
    messages: [
      { role: 'system', content: 'You are a helpful assistant that extracts structured data from text. Always respond with valid JSON only.' },
      { role: 'user', content: prompt }
    ],
  })

  try {
    // Parse the AI response to extract JSON
    const responseText = response.response || JSON.stringify(response)

    // Try to find JSON in the response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('No JSON found in AI response')
    }

    const criteria = JSON.parse(jsonMatch[0]) as CareerCriteria

    // Clean up empty values
    const cleanedCriteria: CareerCriteria = {}
    for (const [key, value] of Object.entries(criteria)) {
      if (value && (typeof value === 'string' ? value.trim() : value.length > 0)) {
        cleanedCriteria[key] = value
      }
    }

    return cleanedCriteria
  } catch (error) {
    console.error('Error parsing AI response:', error)
    // Return a basic structure if parsing fails
    return {
      almaMater: 'Unknown',
      skills: []
    }
  }
}

async function findMatchingProfiles(
  criteria: CareerCriteria,
  careerGoal: string,
  apiKey: string
): Promise<MatchedProfile[]> {
  // Build search query based on criteria and career goal
  const queryParts: string[] = [careerGoal]

  if (criteria.almaMater) {
    queryParts.push(`attended ${criteria.almaMater}`)
  }

  if (criteria.previousCompanies && criteria.previousCompanies.length > 0) {
    queryParts.push(`worked at ${criteria.previousCompanies.join(' or ')}`)
  }

  if (criteria.skills && criteria.skills.length > 0) {
    queryParts.push(`skills: ${criteria.skills.slice(0, 3).join(', ')}`)
  }

  const query = queryParts.join(' ')

  const response = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      query,
      numResults: 10,
      type: 'neural',
      contents: {
        text: {
          maxCharacters: 200,
        },
      },
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Exa search API error: ${response.status} - ${errorText}`)
  }

  const data = await response.json() as {
    results: Array<{
      url: string
      title: string
      text?: string
    }>
  }

  return data.results.map(result => ({
    url: result.url,
    title: result.title,
    snippet: result.text || 'No description available',
  }))
}
