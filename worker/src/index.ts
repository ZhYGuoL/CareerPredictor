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

type WorkersAIResponse = {
  response?: string
  [key: string]: unknown
}

type WorkerRequest =
  | {
      mode?: 'analyze'
      linkedinUrl: string
    }
  | {
      mode: 'match'
      careerGoal: string
      selectedPoints: PointOfInterest[]
    }

const MAX_POINTS_OF_INTEREST = 10
const MAX_SELECTED_POINTS = 3
const EXA_REQUEST_TIMEOUT_MS = 20000
const AI_REQUEST_TIMEOUT_MS = 45000
const CLADO_REQUEST_TIMEOUT_MS = 20000

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
      const payload = await request.json() as WorkerRequest
      const mode = payload.mode ?? 'analyze'

      if (mode === 'match') {
        const { careerGoal, selectedPoints } = payload as Extract<WorkerRequest, { mode: 'match' }>

        if (!careerGoal || !careerGoal.trim()) {
          return new Response(
            JSON.stringify({ error: 'Missing career goal for match request' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        if (!Array.isArray(selectedPoints) || selectedPoints.length === 0) {
          return new Response(
            JSON.stringify({ error: 'Please provide up to 3 selected experiences' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        if (selectedPoints.length !== MAX_SELECTED_POINTS) {
          return new Response(
            JSON.stringify({ error: `Exactly ${MAX_SELECTED_POINTS} experiences are required to find matches` }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        console.log('=== Starting Clado match request ===')
        console.log('Career Goal:', careerGoal)
        console.log('Selected Points:', JSON.stringify(selectedPoints, null, 2))

        const criteria: CareerCriteria = {
          pointsOfInterest: selectedPoints.slice(0, MAX_SELECTED_POINTS),
        }

        console.log('\n[STEP 1/1] Finding matching profiles with Clado...')
        const matchedProfiles = await findMatchingProfiles(criteria, careerGoal, env.CLADO_API_KEY)
        console.log('✅ Found', matchedProfiles.length, 'matching profiles')

        console.log('\n=== Match request completed ===\n')
        return new Response(
          JSON.stringify({ matchedProfiles }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      if (!('linkedinUrl' in payload) || !payload.linkedinUrl) {
        return new Response(
          JSON.stringify({ error: 'Missing linkedinUrl for profile analysis' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const { linkedinUrl } = payload

      console.log('=== Starting LinkedIn Profile Analysis ===')
      console.log('LinkedIn URL:', linkedinUrl)

      // Step 1: Crawl LinkedIn profile using Exa
      console.log('\n[STEP 1/2] Crawling LinkedIn profile with Exa...')
      const markdown = await crawlLinkedInProfile(linkedinUrl, env.EXA_API_KEY)
      console.log('✅ Profile crawled successfully. Length:', markdown.length, 'characters')
      console.log('Preview:', markdown.substring(0, 300) + '...')

      // Step 2: Extract career criteria using Cloudflare Workers AI
      console.log('\n[STEP 2/2] Extracting up to 10 career highlights with Workers AI...')
      const criteria = await extractCriteria(markdown, env.AI)
      console.log('✅ Criteria extracted successfully:', JSON.stringify(criteria, null, 2))

      console.log('\n=== Profile analysis completed ===\n')
      return new Response(
        JSON.stringify({ criteria }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    } catch (error) {
      console.error('\n❌ ERROR:', error)
      console.error('Error details:', error instanceof Error ? error.stack : error)
      return new Response(
        JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
  },
}

async function crawlLinkedInProfile(url: string, apiKey: string): Promise<string> {
  const response = await fetchWithTimeout('https://api.exa.ai/contents', {
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
  }, EXA_REQUEST_TIMEOUT_MS, 'Exa API request timed out')

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
const prompt = `Analyze this LinkedIn profile and identify up to 10 of the most important "points of interest" that define this person's unique background and qualifications.

Each point of interest should be:
- Specific and measurable (e.g., "Studied Computer Science at Stanford" not just "went to college")
- Career-relevant (education, work experience, skills, achievements)
- Generalizable (can be matched with similar people)
- Ordered from most to least impactful when possible.

LinkedIn Profile:
${markdown.substring(0, 4000)}

Return ONLY a JSON array of points of interest in this exact format:
[
  {"description": "Studied at Carnegie Mellon University", "type": "education"},
  {"description": "Has internship experience at tech companies", "type": "experience"},
  {"description": "Proficient in Python and Machine Learning", "type": "skill"}
]

Types: education, experience, skill, achievement, background`

  const response = await withTimeout<WorkersAIResponse>(
    ai.run('@cf/meta/llama-3-8b-instruct', {
    messages: [
      { role: 'system', content: 'You analyze LinkedIn profiles and extract key points of interest. Return only valid JSON arrays, no explanations.' },
      { role: 'user', content: prompt }
    ],
    }),
    AI_REQUEST_TIMEOUT_MS,
    'Workers AI request timed out'
  )

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

    return { pointsOfInterest: validPoints.slice(0, MAX_POINTS_OF_INTEREST) }
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
  console.log('   Building Clado query:', query)

  // Call Clado Search API
  const url = new URL('https://search.clado.ai/api/search')
  url.searchParams.append('query', query)
  url.searchParams.append('limit', '10')
  url.searchParams.append('advanced_filtering', 'true')
  url.searchParams.append('legacy', 'false') // Use new format

  console.log('   Calling Clado API...')
  console.log('   URL:', url.toString())

  try {
    // Validate API key format
    if (!apiKey || apiKey.trim() === '') {
      throw new Error('Clado API key is missing')
    }
    
    console.log('   API key format:', apiKey.substring(0, 5) + '...')
    
    const response = await fetchWithTimeout(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    }, CLADO_REQUEST_TIMEOUT_MS, 'Clado API request timed out')

    console.log('   Clado response status:', response.status)
    console.log('   Clado response headers:', Object.fromEntries(response.headers.entries()))

    if (!response.ok) {
      const errorText = await response.text()
      console.error('   Clado API error response:', errorText)
      
      if (response.status === 401) {
        throw new Error('Clado API authentication failed. Please check your API key. Keys should start with "lk_"')
      } else if (response.status === 429) {
        throw new Error('Clado API rate limit exceeded. Please try again later')
      } else {
        throw new Error(`Clado API error (${response.status}): ${errorText}`)
      }
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

    console.log('   Raw Clado response:', JSON.stringify(data, null, 2).substring(0, 500))
    console.log(`   Clado found ${data.total} total results`)
    console.log(`   Results array length: ${data.results?.length || 0}`)
    
    if (!data.results || data.results.length === 0) {
      console.warn('   ⚠️  Clado returned 0 results. The search may be too specific or the query needs adjustment.')
      return []
    }

    console.log(`   Returning ${Math.min(data.results.length, 5)} profiles`)

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
  } catch (error) {
    console.error('   Clado API call failed:', error)
    throw error
  }
}

async function fetchWithTimeout(
  resource: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  timeoutMessage: string
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(resource, { ...init, signal: controller.signal })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(timeoutMessage)
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}
