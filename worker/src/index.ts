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
const EXA_REQUEST_TIMEOUT_MS = 30000
const AI_REQUEST_TIMEOUT_MS = 60000
const CLADO_REQUEST_TIMEOUT_MS = 30000

// CORS headers for frontend communication
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Immediate response for testing
    console.log('📥 Request received:', request.method, request.url)
    
    try {
      const url = new URL(request.url)
      
      // Health check endpoint - respond immediately
      if (request.method === 'GET' && url.pathname === '/health') {
        console.log('✅ Health check - responding')
        return new Response(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      
      // Test endpoint - respond immediately without parsing body
      if (request.method === 'GET' && url.pathname === '/test') {
        console.log('✅ Test endpoint - responding')
        return new Response(JSON.stringify({ test: 'worker is responding' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      
      // Handle CORS preflight
      if (request.method === 'OPTIONS') {
        console.log('✅ CORS preflight request')
        return new Response(null, { headers: corsHeaders })
      }

      if (request.method !== 'POST') {
        console.log('❌ Method not allowed:', request.method)
        return new Response('Method not allowed', { status: 405, headers: corsHeaders })
      }

      // Validate environment variables
      if (!env.EXA_API_KEY) {
        console.error('❌ EXA_API_KEY is missing')
        return new Response(
          JSON.stringify({ error: 'EXA_API_KEY is not configured' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      if (!env.AI) {
        console.error('❌ AI binding is missing')
        return new Response(
          JSON.stringify({ error: 'AI binding is not configured' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      
      console.log('📦 Parsing request body...')
      const payload = await request.json() as WorkerRequest
      console.log('📦 Request payload:', JSON.stringify(payload))
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

      let markdown: string
      try {
        // Step 1: Crawl LinkedIn profile using Exa
        console.log('\n[STEP 1/2] Crawling LinkedIn profile with Exa...')
        markdown = await crawlLinkedInProfile(linkedinUrl, env.EXA_API_KEY)
        console.log('✅ Profile crawled successfully. Length:', markdown.length, 'characters')
        console.log('Preview:', markdown.substring(0, 300) + '...')
      } catch (error) {
        console.error('❌ Failed to crawl LinkedIn profile:', error)
        throw new Error(`Failed to crawl LinkedIn profile: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }

      let criteria: CareerCriteria
      try {
        // Step 2: Extract career criteria using Cloudflare Workers AI
        console.log('\n[STEP 2/2] Extracting up to 10 career highlights with Workers AI...')
        criteria = await extractCriteria(markdown, env.AI)
        console.log('✅ Criteria extracted successfully:', JSON.stringify(criteria, null, 2))
      } catch (error) {
        console.error('❌ Failed to extract criteria:', error)
        throw new Error(`Failed to extract career highlights: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }

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
  try {
    console.log('Calling Exa API for URL:', url)
    const response = await fetchWithTimeout('https://api.exa.ai/contents', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        ids: [url],
        livecrawlTimeout: 10000,
        summary: true,
        text: {
          maxCharacters: 12000,
        },
      }),
    }, EXA_REQUEST_TIMEOUT_MS, 'Exa API request timed out after 30 seconds')

    console.log('Exa API response status:', response.status)

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Exa API error response:', errorText)
      throw new Error(`Exa API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json() as {
      context?: string
      results?: Array<{
        id: string
        title?: string
        url?: string
        text?: string
        summary?: string
      }>
      statuses?: Array<{ id: string; status: string; source?: string }>
    }
    
    console.log('Exa API response structure:', {
      hasContext: !!data.context,
      contextLength: data.context?.length || 0,
      resultsCount: data.results?.length || 0,
      firstResultHasText: !!data.results?.[0]?.text,
      firstResultTextLength: data.results?.[0]?.text?.length || 0,
      statuses: data.statuses
    })
    
    // Log the full response structure for debugging (first 1000 chars)
    console.log('Exa API full response (preview):', JSON.stringify(data).substring(0, 1000))

    // Try to get text from various possible locations
    let primaryText: string | undefined
    
    // First try: context field (most reliable)
    if (data.context && data.context.trim().length > 0) {
      primaryText = data.context
      console.log('Using context field, length:', primaryText.length)
    }
    // Second try: first result's text field
    else if (data.results?.[0]?.text && data.results[0].text.trim().length > 0) {
      primaryText = data.results[0].text
      console.log('Using first result text field, length:', primaryText.length)
    }
    // Third try: concatenate all results
    else if (data.results && data.results.length > 0) {
      primaryText = data.results
        .map(result => {
          const parts: string[] = []
          if (result.title) parts.push(result.title)
          if (result.text) parts.push(result.text)
          if (result.summary) parts.push(result.summary)
          return parts.join('\n')
        })
        .filter(text => text.trim().length > 0)
        .join('\n\n')
      console.log('Using concatenated results, length:', primaryText?.length || 0)
    }

    if (!primaryText || primaryText.trim().length === 0) {
      console.error('❌ No text content found in Exa API response')
      console.error('Response keys:', Object.keys(data))
      console.error('Full response:', JSON.stringify(data, null, 2))
      throw new Error(`Failed to crawl LinkedIn profile: No text content returned. Response structure: ${JSON.stringify(Object.keys(data))}`)
    }

    console.log('Exa API returned text length:', primaryText.length)
    return primaryText
  } catch (error) {
    console.error('Error in crawlLinkedInProfile:', error)
    if (error instanceof Error) {
      throw error
    }
    throw new Error(`Failed to crawl LinkedIn profile: ${String(error)}`)
  }
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

  try {
    console.log('Calling Workers AI...')
    const aiResponse = await withTimeout<WorkersAIResponse>(
      ai.run('@cf/meta/llama-3-8b-instruct', {
        messages: [
          { role: 'system', content: 'You analyze LinkedIn profiles and extract key points of interest. Return only valid JSON arrays, no explanations.' },
          { role: 'user', content: prompt }
        ],
      }),
      AI_REQUEST_TIMEOUT_MS,
      'Workers AI request timed out'
    )

    console.log('Workers AI response received. Type:', typeof aiResponse)
    console.log('Workers AI response keys:', Object.keys(aiResponse || {}))
    console.log('Workers AI response (full):', JSON.stringify(aiResponse).substring(0, 1000))

    // Handle different response formats from Workers AI
    // Workers AI typically returns: { response: string } or streaming format
    let responseText: string
    if (typeof aiResponse === 'string') {
      responseText = aiResponse
    } else if (aiResponse && typeof aiResponse === 'object') {
      // Try common response properties - Workers AI usually uses 'response'
      const resp = aiResponse as Record<string, unknown>
      if (resp.response && typeof resp.response === 'string') {
        responseText = resp.response
      } else if (resp.text && typeof resp.text === 'string') {
        responseText = resp.text
      } else if (resp.content && typeof resp.content === 'string') {
        responseText = resp.content
      } else if (resp.message && typeof resp.message === 'string') {
        responseText = resp.message
      } else {
        // Try to stringify and extract text
        const stringified = JSON.stringify(aiResponse)
        responseText = stringified
      }
    } else {
      responseText = String(aiResponse)
    }

    if (!responseText || responseText.trim().length === 0) {
      throw new Error('Workers AI returned an empty response')
    }

    console.log('Extracted response text length:', responseText.length)
    console.log('Raw AI response preview:', responseText.substring(0, 500))

    // Try to find JSON array in the response
    // First try to parse the entire response as JSON
    let pointsOfInterest: PointOfInterest[] = []
    try {
      const parsed = JSON.parse(responseText)
      if (Array.isArray(parsed)) {
        pointsOfInterest = parsed
      } else if (parsed && Array.isArray(parsed.pointsOfInterest)) {
        pointsOfInterest = parsed.pointsOfInterest
      } else if (parsed && Array.isArray(parsed.results)) {
        pointsOfInterest = parsed.results
      }
    } catch {
      // If direct parse fails, try to find JSON array in the text
      const jsonMatch = responseText.match(/\[[\s\S]*?\]/)
      if (jsonMatch) {
        try {
          pointsOfInterest = JSON.parse(jsonMatch[0])
        } catch (parseError) {
          console.error('Failed to parse JSON array:', parseError)
        }
      }
    }

    // If still no array found, try to extract from markdown code blocks
    if (!Array.isArray(pointsOfInterest) || pointsOfInterest.length === 0) {
      const codeBlockMatch = responseText.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/)
      if (codeBlockMatch) {
        try {
          pointsOfInterest = JSON.parse(codeBlockMatch[1])
        } catch (parseError) {
          console.error('Failed to parse JSON from code block:', parseError)
        }
      }
    }

    if (!Array.isArray(pointsOfInterest) || pointsOfInterest.length === 0) {
      console.error('No JSON array found in AI response.')
      console.error('Full response text:', responseText)
      throw new Error(`No valid JSON array found in AI response. Response preview: ${responseText.substring(0, 300)}`)
    }

    console.log('Parsed points of interest:', JSON.stringify(pointsOfInterest))

    // Validate and clean
    const validPoints = pointsOfInterest.filter(point =>
      point &&
      typeof point === 'object' &&
      point.description &&
      typeof point.description === 'string' &&
      point.description.trim().length > 0 &&
      point.type &&
      typeof point.type === 'string'
    )

    if (validPoints.length === 0) {
      throw new Error('No valid points of interest extracted from profile')
    }

    console.log('Valid points of interest:', JSON.stringify(validPoints))

    return { pointsOfInterest: validPoints.slice(0, MAX_POINTS_OF_INTEREST) }
  } catch (error) {
    console.error('Error in extractCriteria:', error)
    if (error instanceof Error) {
      console.error('Error message:', error.message)
      console.error('Error stack:', error.stack)
    }
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
