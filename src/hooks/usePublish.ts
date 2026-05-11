import { useState, useCallback, useEffect } from 'react';

export interface PublishState {
  isPublished: boolean;
  slug:        string | null;
  url:         string | null;
  isLoading:   boolean;
  error:       string | null;
}

const INITIAL: PublishState = {
  isPublished: false,
  slug:        null,
  url:         null,
  isLoading:   false,
  error:       null,
};

function buildFullUrl(relativeUrl: string): string {
  return `${window.location.origin}${relativeUrl}`;
}

export function usePublish(projectId: string | null) {
  const [state, setState] = useState<PublishState>(INITIAL);

  const checkStatus = useCallback(async (id: string) => {
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const res = await fetch(`/api/projects/${id}/publish-status`, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setState({
        isPublished: data.published,
        slug:        data.slug ?? null,
        url:         data.url  ? buildFullUrl(data.url) : null,
        isLoading:   false,
        error:       null,
      });
    } catch (err) {
      setState((s) => ({ ...s, isLoading: false, error: String(err) }));
    }
  }, []);

  useEffect(() => {
    if (projectId) checkStatus(projectId);
    else setState(INITIAL);
  }, [projectId, checkStatus]);

  const publish = useCallback(async (id: string, slug?: string) => {
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const res = await fetch(`/api/projects/${id}/publish`, {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ slug: slug?.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setState({ isPublished: true, slug: data.slug, url: buildFullUrl(data.url), isLoading: false, error: null });
    } catch (err) {
      setState((s) => ({ ...s, isLoading: false, error: String(err) }));
    }
  }, []);

  const unpublish = useCallback(async (id: string) => {
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const res = await fetch(`/api/projects/${id}/publish`, {
        method:      'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setState(INITIAL);
    } catch (err) {
      setState((s) => ({ ...s, isLoading: false, error: String(err) }));
    }
  }, []);

  return { ...state, publish, unpublish, checkStatus };
}
