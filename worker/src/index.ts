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
      console.log('LinkedIn profile text length:', markdown.length)
      console.log('LinkedIn profile preview:', markdown.substring(0, 500))

      // Step 2: Extract career criteria using Cloudflare Workers AI
      console.log('Extracting career criteria...')
      const criteria = await extractCriteria(markdown, env.AI)
      console.log('Extracted criteria:', JSON.stringify(criteria))

      // Step 3: Create webset and find matching profiles
      console.log('Creating webset and finding matching profiles...')
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
  const prompt = `Extract key information from this LinkedIn profile. Return ONLY a JSON object with these exact fields:

almaMater: The university name (e.g., "Stanford University", "MIT", "University of California Berkeley")
year: Graduation year or current year (e.g., "2024", "Class of 2023")
age: Approximate age if mentioned
previousCompanies: List of company names they worked at (e.g., ["Google", "Microsoft"])
skills: Top 5 technical or professional skills (e.g., ["Python", "Machine Learning", "Leadership"])

LinkedIn Profile:
${markdown.substring(0, 4000)}

Return ONLY this JSON format, no other text:
{"almaMater":"","year":"","age":"","previousCompanies":[],"skills":[]}`

  const response = await ai.run('@cf/meta/llama-3-8b-instruct', {
    messages: [
      { role: 'system', content: 'You extract structured data from LinkedIn profiles. Return only valid JSON, no explanations.' },
      { role: 'user', content: prompt }
    ],
  })

  try {
    // Parse the AI response to extract JSON
    const responseText = response.response || JSON.stringify(response)
    console.log('Raw AI response:', responseText.substring(0, 500))

    // Try to find JSON in the response
    const jsonMatch = responseText.match(/\{[\s\S]*?\}/)
    if (!jsonMatch) {
      console.error('No JSON found in AI response. Full response:', responseText)
      throw new Error('No JSON found in AI response')
    }

    const criteria = JSON.parse(jsonMatch[0]) as CareerCriteria
    console.log('Parsed criteria before cleaning:', JSON.stringify(criteria))

    // Clean up empty values - but keep meaningful data
    const cleanedCriteria: CareerCriteria = {}
    for (const [key, value] of Object.entries(criteria)) {
      if (value !== null && value !== undefined && value !== '') {
        if (typeof value === 'string' && value.trim().length > 0) {
          cleanedCriteria[key] = value.trim()
        } else if (Array.isArray(value) && value.length > 0) {
          cleanedCriteria[key] = value
        }
      }
    }

    console.log('Cleaned criteria:', JSON.stringify(cleanedCriteria))

    // If we got nothing, throw an error instead of returning Unknown
    if (Object.keys(cleanedCriteria).length === 0) {
      throw new Error('No valid criteria extracted from profile')
    }

    return cleanedCriteria
  } catch (error) {
    console.error('Error parsing AI response:', error)
    console.error('Full AI response:', JSON.stringify(response))
    // Throw the error instead of silently returning Unknown
    throw new Error(`Failed to extract criteria from LinkedIn profile: ${error instanceof Error ? error.message : 'Unknown error'}`)
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
  console.log('Webset search query:', query)

  // Step 1: Create webset with search
  const createResponse = await fetch('https://api.exa.ai/websets/v0/websets', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      search: {
        query,
        count: 10,
      },
      enrichments: [
        {
          description: 'Extract the person\'s current role and company',
          format: 'text',
        },
      ],
    }),
  })

  if (!createResponse.ok) {
    const errorText = await createResponse.text()
    throw new Error(`Exa webset creation error: ${createResponse.status} - ${errorText}`)
  }

  const websetData = await createResponse.json() as { id: string; status: string }
  const websetId = websetData.id
  console.log('Created webset:', websetId, 'Status:', websetData.status)

  // Step 2: Wait for webset to be idle (polling with timeout)
  let status = websetData.status
  let attempts = 0
  const maxAttempts = 30 // 30 attempts * 2 seconds = 60 seconds max wait

  while (status !== 'idle' && attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 2000)) // Wait 2 seconds

    const statusResponse = await fetch(`https://api.exa.ai/websets/v0/websets/${websetId}`, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
      },
    })

    if (!statusResponse.ok) {
      throw new Error(`Failed to check webset status: ${statusResponse.status}`)
    }

    const statusData = await statusResponse.json() as { status: string }
    status = statusData.status
    attempts++
    console.log(`Webset status check ${attempts}:`, status)
  }

  if (status !== 'idle') {
    throw new Error('Webset processing timed out')
  }

  // Step 3: Get items from webset
  const itemsResponse = await fetch(`https://api.exa.ai/websets/v0/websets/${websetId}/items`, {
    method: 'GET',
    headers: {
      'x-api-key': apiKey,
    },
  })

  if (!itemsResponse.ok) {
    const errorText = await itemsResponse.text()
    throw new Error(`Failed to get webset items: ${itemsResponse.status} - ${errorText}`)
  }

  const itemsData = await itemsResponse.json() as {
    items: Array<{
      url: string
      title?: string
      enrichments?: Array<{ value?: string }>
    }>
  }

  // Map items to matched profiles
  return itemsData.items.slice(0, 10).map(item => ({
    url: item.url,
    title: item.title || 'LinkedIn Profile',
    snippet: item.enrichments?.[0]?.value || 'Professional profile',
  }))
}
