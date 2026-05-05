import { useEffect, useRef, useState } from 'react'
import type { PullRequest } from '../types/pullRequest'
import { apiPost } from '../utils/api'

interface DeclineReviewModalProps {
  pr: PullRequest
  onClose: () => void
  onSuccess: (prId: number) => void
}

const MAX_REASON = 1000

function DeclineReviewModal({ pr, onClose, onSuccess }: DeclineReviewModalProps) {
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const prNumber = Number(pr.html_url.split('/pull/')[1])
  const trimmed = reason.trim()
  const canSubmit = trimmed.length > 0 && trimmed.length <= MAX_REASON && !submitting

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      await apiPost('decline-review', {
        repo_full_name: pr.repository.full_name,
        pr_number: prNumber,
        pr_id: pr.id,
        pr_title: pr.title,
        pr_html_url: pr.html_url,
        reason: trimmed,
      })
      onSuccess(pr.id)
    } catch (err) {
      setError((err as Error).message || 'Failed to post comment')
      setSubmitting(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      handleSubmit(e as unknown as React.FormEvent)
    }
  }

  return (
    <div className="decline-modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="decline-modal" onClick={e => e.stopPropagation()}>
        <div className="decline-modal-header">
          <div className="decline-modal-title">
            <span className="decline-modal-emoji" aria-hidden="true">&#x1F3C3;</span>
            <div>
              <h2>Can't review this PR?</h2>
              <p className="decline-modal-subtitle">
                {pr.repository.name} &middot; #{prNumber} &middot; {pr.title}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="decline-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            &times;
          </button>
        </div>
        <form onSubmit={handleSubmit} className="decline-modal-body">
          <label htmlFor="decline-reason" className="decline-modal-label">
            Let the author know why. A comment will be posted on your behalf.
          </label>
          <textarea
            id="decline-reason"
            ref={textareaRef}
            value={reason}
            onChange={e => setReason(e.target.value)}
            onKeyDown={onKeyDown}
            maxLength={MAX_REASON}
            rows={4}
            placeholder="e.g. Out on vacation this week, please ask someone else."
            className="decline-modal-textarea"
            disabled={submitting}
          />
          <div className="decline-modal-meta">
            <span className="decline-modal-count">
              {trimmed.length}/{MAX_REASON}
            </span>
            {error && <span className="decline-modal-error">{error}</span>}
          </div>
          <div className="decline-modal-preview">
            <span className="decline-modal-preview-label">Preview</span>
            <div className="decline-modal-preview-body">
              <span aria-hidden="true">&#x1F3C3;</span>{' '}
              {trimmed || <span className="decline-modal-preview-placeholder">Your reason here</span>}
            </div>
          </div>
          <div className="decline-modal-actions">
            <button
              type="button"
              className="decline-modal-cancel"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="decline-modal-submit"
              disabled={!canSubmit}
            >
              {submitting ? 'Posting...' : 'Post comment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default DeclineReviewModal
