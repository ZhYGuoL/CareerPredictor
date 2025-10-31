import { useState } from 'react'
import './App.css'

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

function App() {
  const [linkedinUrl, setLinkedinUrl] = useState('')
  const [careerGoal, setCareerGoal] = useState('')
  const [urlError, setUrlError] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [criteria, setCriteria] = useState<CareerCriteria | null>(null)
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!validateLinkedInUrl(linkedinUrl)) {
      return
    }

    if (!careerGoal.trim()) {
      setError('Please enter a career goal')
      return
    }

    setLoading(true)

    try {
      // Call Cloudflare Worker API endpoint
      const apiUrl = import.meta.env.VITE_API_URL || '/api/analyze'
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          linkedinUrl,
          careerGoal,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to analyze profile')
      }

      const data = await response.json()
      setCriteria(data.criteria)
      setMatchedProfiles(data.matchedProfiles)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>CareerPredictor</h1>
        <p className="subtitle">Discover career paths based on similar professionals</p>
      </header>

      <div className="privacy-notice">
        <strong>Privacy Notice:</strong> Your data is processed in-memory and never stored or shared.
      </div>

      <form onSubmit={handleSubmit} className="input-form">
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
            disabled={loading}
          />
          {urlError && <span className="error-message">{urlError}</span>}
        </div>

        <div className="form-group">
          <label htmlFor="career-goal">Career Goal</label>
          <input
            id="career-goal"
            type="text"
            value={careerGoal}
            onChange={(e) => setCareerGoal(e.target.value)}
            placeholder="e.g., working at a FAANG company in my senior year of undergrad"
            disabled={loading}
          />
        </div>

        <button type="submit" disabled={loading} className="submit-button">
          {loading ? 'Analyzing...' : 'Find Similar Professionals'}
        </button>
      </form>

      {error && (
        <div className="error-banner">
          <strong>Error:</strong> {error}
        </div>
      )}

      {loading && (
        <div className="loading-container">
          <div className="spinner"></div>
          <p>Analyzing your profile and finding matches...</p>
        </div>
      )}

      {criteria && !loading && (
        <div className="results-section">
          <h2>Extracted Career Criteria</h2>
          <div className="criteria-card">
            {Object.entries(criteria).map(([key, value]) => (
              <div key={key} className="criteria-item">
                <strong>{key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}:</strong>{' '}
                {Array.isArray(value) ? value.join(', ') : value}
              </div>
            ))}
          </div>
        </div>
      )}

      {matchedProfiles.length > 0 && !loading && (
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
