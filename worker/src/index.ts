interface Env {
  AI: any
  EXA_API_KEY: string
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
  // Use a generic query for people/professionals
  const query = 'professional LinkedIn profiles'
  console.log('Webset search query:', query)

  // Convert points of interest into Exa criteria, and add career goal as first criterion
  const exaCriteria = [
    { description: careerGoal }, // Career goal as the primary criterion
    ...criteria.pointsOfInterest.slice(0, 4).map(point => ({ // Limit to 4 more (max 5 total)
      description: point.description
    }))
  ]

  console.log('Webset criteria:', JSON.stringify(exaCriteria))

  // Step 1: Create webset with search and criteria
  const createResponse = await fetch('https://api.exa.ai/websets/v0/websets', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      search: {
        query, // Generic query for professionals
        count: 5,
        entity: {
          type: 'person',
        },
        criteria: exaCriteria, // Career goal + points of interest as matching criteria
        recall: false,
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
  const maxAttempts = 20 // 20 attempts * 3 seconds = 60 seconds max wait
  let lastStatusData: any = null

  while (status !== 'idle' && attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 3000)) // Wait 3 seconds between checks

    const statusResponse = await fetch(`https://api.exa.ai/websets/v0/websets/${websetId}`, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
      },
    })

    if (!statusResponse.ok) {
      throw new Error(`Failed to check webset status: ${statusResponse.status}`)
    }

    lastStatusData = await statusResponse.json()
    status = lastStatusData.status
    attempts++

    // Log progress if available
    const progress = lastStatusData.searches?.[0]?.progress
    if (progress) {
      console.log(`Webset status check ${attempts}: ${status} - Found: ${progress.found}, Analyzed: ${progress.analyzed}, Completion: ${progress.completion}%`)
    } else {
      console.log(`Webset status check ${attempts}:`, status)
    }

    // If we have some results and it's been too long, we can stop early
    if (attempts >= 15 && progress && progress.found >= 3) {
      console.log('Found sufficient results, stopping early')
      break
    }
  }

  if (status !== 'idle' && (!lastStatusData?.searches?.[0]?.progress?.found || lastStatusData.searches[0].progress.found === 0)) {
    throw new Error('Webset processing timed out without finding any results. Try a broader search query.')
  }

  console.log('Webset processing completed or stopped. Status:', status)

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
  console.log(`Retrieved ${itemsData.items.length} items from webset`)
  return itemsData.items.slice(0, 5).map(item => ({
    url: item.url,
    title: item.title || 'LinkedIn Profile',
    snippet: item.enrichments?.[0]?.value || 'Professional profile',
  }))
}
