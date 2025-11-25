import { useState } from 'react'
import './App.css'

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

const MAX_SELECTION = 3
const ANALYZE_TIMEOUT_MS = 60000
const MATCH_TIMEOUT_MS = 45000

async function fetchWithTimeout(
  resource: RequestInfo | URL,
  options: RequestInit,
  timeoutMs: number,
  timeoutMessage: string
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(resource, { ...options, signal: controller.signal })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(timeoutMessage)
    }
    if (error instanceof Error) {
      throw error
    }
    throw new Error('Unexpected network error')
  } finally {
    window.clearTimeout(timeoutId)
  }
}

function App() {
  const [linkedinUrl, setLinkedinUrl] = useState('')
  const [dreamGoal, setDreamGoal] = useState('')
  const [urlError, setUrlError] = useState('')
  const [error, setError] = useState('')
  const [selectionMessage, setSelectionMessage] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [matching, setMatching] = useState(false)
  const [criteria, setCriteria] = useState<CareerCriteria | null>(null)
  const [selectedPoints, setSelectedPoints] = useState<PointOfInterest[]>([])
  const [matchedProfiles, setMatchedProfiles] = useState<MatchedProfile[]>([])

  const validateLinkedInUrl = (url: string): boolean => {
    if (!url.trim()) {
      setUrlError('LinkedIn URL is required')
      return false
    }

    const linkedinPattern = /^https?:\/\/(www\.)?linkedin\.com\/.+/i
    if (!linkedinPattern.test(url)) {
      setUrlError('Please enter a valid LinkedIn URL')
      return false
    }

    setUrlError('')
    return true
  }

  const handleAnalyzeProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!validateLinkedInUrl(linkedinUrl)) {
      return
    }

    setAnalyzing(true)
    setSelectionMessage('')

    try {
      // Call Cloudflare Worker API endpoint
      const apiUrl = import.meta.env.VITE_API_URL || '/api'
      const response = await fetchWithTimeout(
        apiUrl,
        {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: 'analyze',
          linkedinUrl,
        }),
        },
        ANALYZE_TIMEOUT_MS,
        'Profile analysis timed out. Please try again.'
      )

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to analyze profile')
      }

      const data = await response.json() as { criteria: CareerCriteria }
      setCriteria(data.criteria)
      setMatchedProfiles([])
      setSelectedPoints([])
      setDreamGoal('')
      setSelectionMessage('Pick the 3 experiences that feel most representative.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setAnalyzing(false)
    }
  }

  const togglePointSelection = (point: PointOfInterest) => {
    if (!criteria) return

    const isAlreadySelected = selectedPoints.some(
      (selected) =>
        selected.description === point.description && selected.type === point.type
    )

    if (isAlreadySelected) {
      setSelectedPoints((prev) =>
        prev.filter(
          (selected) =>
            !(selected.description === point.description && selected.type === point.type)
        )
      )
      setSelectionMessage('Selection updated.')
      return
    }

    if (selectedPoints.length >= MAX_SELECTION) {
      setSelectionMessage('You can only choose three experiences.')
      return
    }

    setSelectedPoints((prev) => [...prev, point])
    setSelectionMessage(
      selectedPoints.length + 1 === MAX_SELECTION
        ? 'Great! Now tell us your dream goal below.'
        : 'Selection updated.'
    )
  }

  const handleFindMatches = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (selectedPoints.length !== MAX_SELECTION) {
      setError('Please select exactly three experiences.')
      return
    }

    if (!dreamGoal.trim()) {
      setError('Please enter your dream goal.')
      return
    }

    setMatching(true)

    try {
      const apiUrl = import.meta.env.VITE_API_URL || '/api'
      const response = await fetchWithTimeout(
        apiUrl,
        {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: 'match',
          careerGoal: dreamGoal,
          selectedPoints,
        }),
        },
        MATCH_TIMEOUT_MS,
        'Finding matching professionals timed out. Please try again.'
      )

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to find matches')
      }

      const data = await response.json() as { matchedProfiles: MatchedProfile[] }
      setMatchedProfiles(data.matchedProfiles)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred while finding matches')
    } finally {
      setMatching(false)
    }
  }

  const isPointSelected = (point: PointOfInterest) =>
    selectedPoints.some(
      (selected) =>
        selected.description === point.description && selected.type === point.type
    )

  const isLoading = analyzing || matching
  const loadingMessage = analyzing
    ? 'Analyzing your profile and extracting highlights...'
    : 'Finding professionals who match your dream goal...'

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>CareerPredictor</h1>
        <p className="subtitle">Turn your LinkedIn story into a targeted career search</p>
      </header>

      <div className="privacy-notice">
        <strong>Privacy Notice:</strong> Your data is processed in-memory and never stored or shared.
      </div>

      <form onSubmit={handleAnalyzeProfile} className="input-form">
        <div className="form-group">
          <label htmlFor="linkedin-url">LinkedIn Profile URL</label>
          <input
            id="linkedin-url"
            type="text"
            value={linkedinUrl}
            onChange={(e) => {
              setLinkedinUrl(e.target.value)
              if (urlError) setUrlError('')
            }}
            placeholder="https://www.linkedin.com/in/username"
            className={urlError ? 'error' : ''}
            disabled={analyzing}
          />
          {urlError && <span className="error-message">{urlError}</span>}
        </div>

        <button type="submit" disabled={analyzing} className="submit-button">
          {analyzing ? 'Analyzing Profile...' : 'Analyze LinkedIn Profile'}
        </button>
      </form>

      {error && (
        <div className="error-banner">
          <strong>Error:</strong> {error}
        </div>
      )}

      {isLoading && (
        <div className="loading-container">
          <div className="spinner"></div>
          <p>{loadingMessage}</p>
        </div>
      )}

      {criteria && !analyzing && (
        <div className="results-section">
          <div className="results-heading">
            <h2>Choose Your Top Experiences</h2>
            <p className="section-hint">
              We&apos;ve pulled up to 10 highlights. Click to select the three that best represent you.
            </p>
          </div>
          <div className="criteria-grid">
            {criteria.pointsOfInterest.map((point, index) => {
              const selected = isPointSelected(point)
              return (
                <button
                  type="button"
                  key={`${point.description}-${index}`}
                  className={`criteria-item selectable ${selected ? 'selected' : ''}`}
                  onClick={() => togglePointSelection(point)}
                >
                  <span className="criteria-type">{point.type}</span>
                  <span className="criteria-description">{point.description}</span>
                  {selected && <span className="criteria-check">Selected</span>}
                </button>
              )
            })}
          </div>
          <div className="selection-summary">
            <span>
              Selected {selectedPoints.length} / {MAX_SELECTION} experiences
            </span>
            {selectionMessage && <span className="selection-message">{selectionMessage}</span>}
          </div>
        </div>
      )}

      {criteria && (
        <form onSubmit={handleFindMatches} className="match-form">
          <div className="form-group">
            <label htmlFor="dream-goal">Your Dream Goal</label>
            <input
              id="dream-goal"
              type="text"
              value={dreamGoal}
              onChange={(e) => setDreamGoal(e.target.value)}
              placeholder="e.g., Lead AI product manager at a Series B startup"
              disabled={matching || selectedPoints.length !== MAX_SELECTION}
            />
          </div>
          <button
            type="submit"
            className="submit-button"
            disabled={matching || selectedPoints.length !== MAX_SELECTION || !dreamGoal.trim()}
          >
            {matching ? 'Finding Matches...' : 'Find Matching Professionals'}
          </button>
        </form>
      )}

      {matchedProfiles.length > 0 && !matching && (
        <div className="results-section">
          <h2>Matched Professionals</h2>
          <div className="profiles-list">
            {matchedProfiles.map((profile, index) => (
              <div key={index} className="profile-card">
                <h3>
                  <a href={profile.url} target="_blank" rel="noopener noreferrer">
                    {profile.title}
                  </a>
                </h3>
                <p className="profile-snippet">{profile.snippet}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default App
