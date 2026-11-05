import React from 'react';
import './css/PreviewBadge.css';

// Vercel exposes REACT_APP_VERCEL_* system env vars to CRA builds.
// Only shown on preview deployments so production is never affected.
const env = process.env.REACT_APP_VERCEL_ENV;
const branch = process.env.REACT_APP_VERCEL_GIT_COMMIT_REF;
const sha = (process.env.REACT_APP_VERCEL_GIT_COMMIT_SHA || '').slice(0, 7);

export default function PreviewBadge() {
  if (env !== 'preview') return null;
  return (
    <div className="preview-badge" title={`Vercel preview · ${branch || ''} ${sha}`.trim()}>
      Preview{branch ? ` · ${branch}` : ''}{sha ? ` @ ${sha}` : ''}
    </div>
  );
}
