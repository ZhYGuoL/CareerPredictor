interface Env {
  AI: any
  EXA_API_KEY: string
  CLADO_API_KEY: string
}

interface PointOfInterest {
  description: string
  type: 'education' | 'experience' | 'skill' | 'achievement' | 'background'
}

interface CareerCriteria {
  pointsOfInterest: PointOfInterest[]
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

      // Step 3: Find matching profiles using Clado
      console.log('Finding matching profiles with Clado...')
      const matchedProfiles = await findMatchingProfiles(criteria, careerGoal, env.CLADO_API_KEY)

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
  const prompt = `Analyze this LinkedIn profile and identify 3-5 key "points of interest" that define this person's unique background and qualifications.

Each point of interest should be:
- Specific and measurable (e.g., "Studied Computer Science at Stanford" not just "went to college")
- Career-relevant (education, work experience, skills, achievements)
- Generalizable (can be matched with similar people)

LinkedIn Profile:
${markdown.substring(0, 4000)}

Return ONLY a JSON array of points of interest in this exact format:
[
  {"description": "Studied at Carnegie Mellon University", "type": "education"},
  {"description": "Has internship experience at tech companies", "type": "experience"},
  {"description": "Proficient in Python and Machine Learning", "type": "skill"}
]

Types: education, experience, skill, achievement, background`

  const response = await ai.run('@cf/meta/llama-3-8b-instruct', {
    messages: [
      { role: 'system', content: 'You analyze LinkedIn profiles and extract key points of interest. Return only valid JSON arrays, no explanations.' },
      { role: 'user', content: prompt }
    ],
  })

  try {
    // Parse the AI response to extract JSON
    const responseText = response.response || JSON.stringify(response)
    console.log('Raw AI response:', responseText.substring(0, 500))

    // Try to find JSON array in the response
    const jsonMatch = responseText.match(/\[[\s\S]*?\]/)
    if (!jsonMatch) {
      console.error('No JSON array found in AI response. Full response:', responseText)
      throw new Error('No JSON array found in AI response')
    }

    const pointsOfInterest = JSON.parse(jsonMatch[0]) as PointOfInterest[]
    console.log('Parsed points of interest:', JSON.stringify(pointsOfInterest))

    // Validate and clean
    const validPoints = pointsOfInterest.filter(point =>
      point.description &&
      point.description.trim().length > 0 &&
      point.type
    )

    if (validPoints.length === 0) {
      throw new Error('No valid points of interest extracted from profile')
    }

    console.log('Valid points of interest:', JSON.stringify(validPoints))

    return { pointsOfInterest: validPoints.slice(0, 5) } // Max 5 criteria per Exa API limit
  } catch (error) {
    console.error('Error parsing AI response:', error)
    console.error('Full AI response:', JSON.stringify(response))
    throw new Error(`Failed to extract points of interest from LinkedIn profile: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

async function findMatchingProfiles(
  criteria: CareerCriteria,
  careerGoal: string,
  apiKey: string
): Promise<MatchedProfile[]> {
  // Build a natural language query from career goal and points of interest
  const pointsDescription = criteria.pointsOfInterest
    .map(point => point.description)
    .join(', ')
  
  const query = `${careerGoal}. Looking for professionals with: ${pointsDescription}`
  console.log('Clado search query:', query)

  // Call Clado Search API
  const url = new URL('https://search.clado.ai/api/search')
  url.searchParams.append('query', query)
  url.searchParams.append('limit', '10')
  url.searchParams.append('advanced_filtering', 'true')
  url.searchParams.append('legacy', 'false') // Use new format

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Clado API error: ${response.status} - ${errorText}`)
  }

  const data = await response.json() as {
    results: Array<{
      profile: {
        name: string
        headline?: string
        linkedin_url: string
        description?: string
        location?: string
      }
      experience?: Array<{
        title: string
        company_name: string
        description?: string
      }>
    }>
    total: number
    search_id: string
  }

  console.log(`Clado found ${data.total} total results, returning ${data.results.length} profiles`)

  // Map Clado results to MatchedProfile format
  return data.results.slice(0, 5).map(result => {
    const profile = result.profile
    const currentRole = result.experience?.[0]
    
    // Build a snippet from available information
    let snippet = profile.headline || ''
    if (currentRole) {
      snippet = `${currentRole.title} at ${currentRole.company_name}`
    }
    if (profile.location) {
      snippet += ` • ${profile.location}`
    }
    if (profile.description) {
      snippet += ` • ${profile.description.substring(0, 150)}...`
    }

    return {
      url: profile.linkedin_url,
      title: profile.name,
      snippet: snippet || 'LinkedIn Professional',
    }
  })
}
