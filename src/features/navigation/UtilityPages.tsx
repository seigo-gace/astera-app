import { useState, type FormEvent } from 'react';
import { useAppText } from '../../app-text';
import { asArray, recordText } from '../../platform/api-client';
import type { RouteMatch } from '../../platform/route-registry';
import { BusyState, ErrorState, ResponsivePageShell } from '../../platform/ResponsivePageShell';
import { Field, Panel, RecordList, useResource } from '../../platform/pages/page-kit';

export function SearchPage({ route }: { route: RouteMatch }) {
  const { text } = useAppText();
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const endpoint = `/api/history${activeQuery ? `?q=${encodeURIComponent(activeQuery)}` : ''}`;
  const [resource, reload] = useResource(endpoint);
  const submit = (event: FormEvent) => { event.preventDefault(); setActiveQuery(query.trim()); window.setTimeout(reload, 0); };
  return (
    <ResponsivePageShell route={route} description={text('searchDescription')}>
      <Panel title={text('searchTitle')}>
        <form className="platform-inline-form" onSubmit={submit}><Field label={text('searchKeyword')} name="q" value={query} onChange={setQuery} /><button className="platform-button is-primary" type="submit">{text('searchButton')}</button></form>
      </Panel>
      <Panel title={text('navHistory')}>
        {resource.status === 'loading' && <BusyState />}
        {resource.status === 'error' && <ErrorState error={resource.error} onRetry={reload} />}
        {resource.status === 'ready' && <RecordList items={asArray(resource.data, ['history','items','results'])} titleKeys={['title','prompt','name','result_id','id']} subtitleKeys={['created_at','updated_at','status']} link={(record) => { const id = recordText(record, ['result_id','id']); return id ? `/app/results/${encodeURIComponent(id)}` : null; }} />}
      </Panel>
    </ResponsivePageShell>
  );
}

export function PlanCreditPage({ route }: { route: RouteMatch }) {
  const { text } = useAppText();
  return (
    <ResponsivePageShell route={route} description={text('planCreditDescription')}>
      <div className="platform-card-grid">
        <a className="platform-link-card" href="/account/subscription"><strong>{text('planLink')}</strong><span>{text('planCreditDescription')}</span><b>›</b></a>
        <a className="platform-link-card" href="/account/credit"><strong>{text('creditLink')}</strong><span>{text('planCreditDescription')}</span><b>›</b></a>
      </div>
    </ResponsivePageShell>
  );
}
