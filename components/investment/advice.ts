export type AdviceAction = 'buy' | 'reduce' | 'hold' | 'watch' | 'wait'

export type AdviceEvidence = {
  label: string
  value: number | string | null
  unit?: string
  source?: string
  date?: string
  url?: string
}

export type AdviceTrigger = {
  label: string
  price: number | null
  condition: string
}

export type InstrumentAdvice = {
  decision_id: string
  instrument_id: string
  name: string
  kind: string
  held: boolean
  quantity: number | null
  weight_pct: number | null
  current_price: number | null
  as_of: string | null
  history_as_of: string | null
  status: string
  action: AdviceAction
  action_label: string
  headline: string
  strength: 'strong' | 'neutral' | 'weak' | 'unknown'
  reasons: string[]
  risks: string[]
  blockers: string[]
  triggers: AdviceTrigger[]
  evidence: AdviceEvidence[]
  plan: {
    action: 'observe' | 'consider' | 'no_trade'
    observation: string
    buy_condition: string
    exit_condition: string
    invalidation: string
    budget: number | null
    notes: string
  }
}

export type AdviceBundle = {
  as_of: string
  generated_at: string
  context_id: string
  engine: {
    version: string
    kind: 'transparent_rules'
    title: string
    validation: 'unvalidated'
    limitations: string[]
    assumptions: string[]
  }
  overall: {
    action: 'defend' | 'balanced' | 'watch'
    title: string
    summary: string
    buying_allowed: boolean
    blockers: string[]
  }
  market: {
    label: string
    data_status: 'complete' | 'partial' | 'missing' | 'stale'
    score: number | null
    score_label: string | null
    coverage: { available: number; total: number; missing: string[] }
    dimensions: { key: string; label: string; status: string; summary: string; value: number | string | null }[]
  }
  holdings: InstrumentAdvice[]
  watchlist: InstrumentAdvice[]
  actions: { id: string; priority: number; title: string; description: string; instrument_id?: string; kind: 'review' | 'configure' | 'refresh' }[]
  disclaimer: string
}
