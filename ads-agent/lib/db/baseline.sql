--
-- PostgreSQL database dump
--

\restrict 6tRK3Plv3ctA11u1L7LVGu18smdtzAFymqkwoj54AvfUDGHdFoSfnBCB5SuyTMj

-- Dumped from database version 18.4 (Debian 18.4-1.pgdg12+1)
-- Dumped by pg_dump version 18.2

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: adsagent; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA adsagent;


--
-- Name: SCHEMA adsagent; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA adsagent IS 'standard public schema';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: ai_action_log; Type: TABLE; Schema: adsagent; Owner: -
--

CREATE TABLE adsagent.ai_action_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    domain text NOT NULL,
    summary text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_action_log_domain_check CHECK ((domain = ANY (ARRAY['marketing'::text, 'crm'::text])))
);


--
-- Name: campaign_draft_messages; Type: TABLE; Schema: adsagent; Owner: -
--

CREATE TABLE adsagent.campaign_draft_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    draft_id uuid NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT campaign_draft_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text])))
);


--
-- Name: campaign_drafts; Type: TABLE; Schema: adsagent; Owner: -
--

CREATE TABLE adsagent.campaign_drafts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    status text DEFAULT 'chatting'::text NOT NULL,
    corridor text,
    daily_budget_inr numeric,
    ad_group_name text,
    keywords jsonb DEFAULT '[]'::jsonb NOT NULL,
    headlines jsonb DEFAULT '[]'::jsonb NOT NULL,
    descriptions jsonb DEFAULT '[]'::jsonb NOT NULL,
    final_url text DEFAULT 'https://www.gentlespacesolutions.com/spaces'::text NOT NULL,
    proposal_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT campaign_drafts_status_check CHECK ((status = ANY (ARRAY['chatting'::text, 'ready'::text, 'converted'::text])))
);


--
-- Name: campaigns; Type: TABLE; Schema: adsagent; Owner: -
--

CREATE TABLE adsagent.campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    platform text NOT NULL,
    external_id text,
    name text NOT NULL,
    status text DEFAULT 'proposed'::text NOT NULL,
    daily_budget numeric,
    corridor text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT campaigns_platform_check CHECK ((platform = ANY (ARRAY['meta'::text, 'google'::text]))),
    CONSTRAINT campaigns_status_check CHECK ((status = ANY (ARRAY['proposed'::text, 'active'::text, 'paused'::text, 'removed'::text])))
);


--
-- Name: credit_grants; Type: TABLE; Schema: adsagent; Owner: -
--

CREATE TABLE adsagent.credit_grants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    user_id uuid,
    amount_credits numeric NOT NULL,
    granted_by text NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT credit_grants_amount_credits_check CHECK ((amount_credits > (0)::numeric))
);


--
-- Name: crm_signal_snapshots; Type: TABLE; Schema: adsagent; Owner: -
--

CREATE TABLE adsagent.crm_signal_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid,
    captured_at timestamp with time zone DEFAULT now() NOT NULL,
    hot_count integer DEFAULT 0 NOT NULL,
    warm_count integer DEFAULT 0 NOT NULL,
    cold_count integer DEFAULT 0 NOT NULL,
    unscored_count integer DEFAULT 0 NOT NULL
);


--
-- Name: cron_settings; Type: TABLE; Schema: adsagent; Owner: -
--

CREATE TABLE adsagent.cron_settings (
    id integer DEFAULT 1 NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    last_run_at timestamp with time zone,
    CONSTRAINT cron_settings_id_check CHECK ((id = 1))
);


--
-- Name: org_balances; Type: TABLE; Schema: adsagent; Owner: -
--

CREATE TABLE adsagent.org_balances (
    org_id uuid NOT NULL,
    balance_credits numeric DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT org_balances_balance_credits_check CHECK ((balance_credits >= (0)::numeric))
);


--
-- Name: orgs; Type: TABLE; Schema: adsagent; Owner: -
--

CREATE TABLE adsagent.orgs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    kind text DEFAULT 'external'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT orgs_kind_check CHECK ((kind = ANY (ARRAY['internal'::text, 'external'::text])))
);


--
-- Name: performance_snapshots; Type: TABLE; Schema: adsagent; Owner: -
--

CREATE TABLE adsagent.performance_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid,
    captured_at timestamp with time zone DEFAULT now() NOT NULL,
    spend numeric DEFAULT 0 NOT NULL,
    clicks integer DEFAULT 0 NOT NULL,
    impressions integer DEFAULT 0 NOT NULL,
    conversions integer DEFAULT 0 NOT NULL,
    cpl numeric,
    raw jsonb
);


--
-- Name: proposals; Type: TABLE; Schema: adsagent; Owner: -
--

CREATE TABLE adsagent.proposals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    campaign_id uuid,
    payload jsonb NOT NULL,
    triggered_rule text NOT NULL,
    rationale text,
    status text DEFAULT 'pending'::text NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_at timestamp with time zone,
    executed_at timestamp with time zone,
    decided_by uuid,
    decided_via text,
    CONSTRAINT proposals_decided_via_check CHECK (((decided_via IS NULL) OR (decided_via = ANY (ARRAY['ui'::text, 'bulk'::text, 'api'::text, 'system'::text])))),
    CONSTRAINT proposals_kind_check CHECK ((kind = ANY (ARRAY['create_campaign'::text, 'pause'::text, 'budget_change'::text, 'add_negative_keyword'::text, 'campaign_strategy'::text]))),
    CONSTRAINT proposals_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'executed'::text, 'failed'::text])))
);


--
-- Name: usage_ledger; Type: TABLE; Schema: adsagent; Owner: -
--

CREATE TABLE adsagent.usage_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    user_id uuid NOT NULL,
    feature text NOT NULL,
    provider text NOT NULL,
    model text NOT NULL,
    prompt_tokens integer NOT NULL,
    completion_tokens integer NOT NULL,
    total_tokens integer NOT NULL,
    cost_usd numeric NOT NULL,
    credits_debited numeric NOT NULL,
    request_id text,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_balances; Type: TABLE; Schema: adsagent; Owner: -
--

CREATE TABLE adsagent.user_balances (
    user_id uuid NOT NULL,
    org_id uuid NOT NULL,
    balance_credits numeric DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_balances_balance_credits_check CHECK ((balance_credits >= (0)::numeric))
);


--
-- Name: users; Type: TABLE; Schema: adsagent; Owner: -
--

CREATE TABLE adsagent.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    email text NOT NULL,
    display_name text,
    role text DEFAULT 'viewer'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT users_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'operator'::text, 'viewer'::text])))
);


--
-- Name: ai_action_log ai_action_log_pkey; Type: CONSTRAINT; Schema: adsagent; Owner: -
--

ALTER TABLE ONLY adsagent.ai_action_log
    ADD CONSTRAINT ai_action_log_pkey PRIMARY KEY (id);


--
-- Name: campaign_draft_messages campaign_draft_messages_pkey; Type: CONSTRAINT; Schema: adsagent; Owner: -
--

ALTER TABLE ONLY adsagent.campaign_draft_messages
    ADD CONSTRAINT campaign_draft_messages_pkey PRIMARY KEY (id);


--
-- Name: campaign_drafts campaign_drafts_pkey; Type: CONSTRAINT; Schema: adsagent; Owner: -
--

ALTER TABLE ONLY adsagent.campaign_drafts
    ADD CONSTRAINT campaign_drafts_pkey PRIMARY KEY (id);


--
-- Name: campaigns campaigns_pkey; Type: CONSTRAINT; Schema: adsagent; Owner: -
--

ALTER TABLE ONLY adsagent.campaigns
    ADD CONSTRAINT campaigns_pkey PRIMARY KEY (id);


--
-- Name: credit_grants credit_grants_pkey; Type: CONSTRAINT; Schema: adsagent; Owner: -
--

ALTER TABLE ONLY adsagent.credit_grants
    ADD CONSTRAINT credit_grants_pkey PRIMARY KEY (id);


--
-- Name: crm_signal_snapshots crm_signal_snapshots_pkey; Type: CONSTRAINT; Schema: adsagent; Owner: -
--

ALTER TABLE ONLY adsagent.crm_signal_snapshots
    ADD CONSTRAINT crm_signal_snapshots_pkey PRIMARY KEY (id);


--
-- Name: cron_settings cron_settings_pkey; Type: CONSTRAINT; Schema: adsagent; Owner: -
--

ALTER TABLE ONLY adsagent.cron_settings
    ADD CONSTRAINT cron_settings_pkey PRIMARY KEY (id);


--
-- Name: org_balances org_balances_pkey; Type: CONSTRAINT; Schema: adsagent; Owner: -
--

ALTER TABLE ONLY adsagent.org_balances
    ADD CONSTRAINT org_balances_pkey PRIMARY KEY (org_id);


--
-- Name: orgs orgs_pkey; Type: CONSTRAINT; Schema: adsagent; Owner: -
--

ALTER TABLE ONLY adsagent.orgs
    ADD CONSTRAINT orgs_pkey PRIMARY KEY (id);


--
-- Name: performance_snapshots performance_snapshots_pkey; Type: CONSTRAINT; Schema: adsagent; Owner: -
--

ALTER TABLE ONLY adsagent.performance_snapshots
    ADD CONSTRAINT performance_snapshots_pkey PRIMARY KEY (id);


--
-- Name: proposals proposals_pkey; Type: CONSTRAINT; Schema: adsagent; Owner: -
--

ALTER TABLE ONLY adsagent.proposals
    ADD CONSTRAINT proposals_pkey PRIMARY KEY (id);


--
-- Name: usage_ledger usage_ledger_pkey; Type: CONSTRAINT; Schema: adsagent; Owner: -
--

ALTER TABLE ONLY adsagent.usage_ledger
    ADD CONSTRAINT usage_ledger_pkey PRIMARY KEY (id);


--
-- Name: user_balances user_balances_pkey; Type: CONSTRAINT; Schema: adsagent; Owner: -
--

ALTER TABLE ONLY adsagent.user_balances
    ADD CONSTRAINT user_balances_pkey PRIMARY KEY (user_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: adsagent; Owner: -
--

ALTER TABLE ONLY adsagent.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: adsagent; Owner: -
--

ALTER TABLE ONLY adsagent.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: campaign_draft_messages campaign_draft_messages_draft_id_fkey; Type: FK CONSTRAINT; Schema: adsagent; Owner: -
--

ALTER TABLE ONLY adsagent.campaign_draft_messages
    ADD CONSTRAINT campaign_draft_messages_draft_id_fkey FOREIGN KEY (draft_id) REFERENCES adsagent.campaign_drafts(id);


--
-- Name: campaign_drafts campaign_drafts_proposal_id_fkey; Type: FK CONSTRAINT; Schema: adsagent; Owner: -
--

ALTER TABLE ONLY adsagent.campaign_drafts
    ADD CONSTRAINT campaign_drafts_proposal_id_fkey FOREIGN KEY (proposal_id) REFERENCES adsagent.proposals(id);


--
-- Name: credit_grants credit_grants_org_id_fkey; Type: FK CONSTRAINT; Schema: adsagent; Owner: -
--

ALTER TABLE ONLY adsagent.credit_grants
    ADD CONSTRAINT credit_grants_org_id_fkey FOREIGN KEY (org_id) REFERENCES adsagent.orgs(id);


--
-- Name: credit_grants credit_grants_user_id_fkey; Type: FK CONSTRAINT; Schema: adsagent; Owner: -
--

ALTER TABLE ONLY adsagent.credit_grants
    ADD CONSTRAINT credit_grants_user_id_fkey FOREIGN KEY (user_id) REFERENCES adsagent.users(id);


--
-- Name: crm_signal_snapshots crm_signal_snapshots_campaign_id_fkey; Type: FK CONSTRAINT; Schema: adsagent; Owner: -
--

ALTER TABLE ONLY adsagent.crm_signal_snapshots
    ADD CONSTRAINT crm_signal_snapshots_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES adsagent.campaigns(id);


--
-- Name: org_balances org_balances_org_id_fkey; Type: FK CONSTRAINT; Schema: adsagent; Owner: -
--

ALTER TABLE ONLY adsagent.org_balances
    ADD CONSTRAINT org_balances_org_id_fkey FOREIGN KEY (org_id) REFERENCES adsagent.orgs(id);


--
-- Name: performance_snapshots performance_snapshots_campaign_id_fkey; Type: FK CONSTRAINT; Schema: adsagent; Owner: -
--

ALTER TABLE ONLY adsagent.performance_snapshots
    ADD CONSTRAINT performance_snapshots_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES adsagent.campaigns(id);


--
-- Name: proposals proposals_campaign_id_fkey; Type: FK CONSTRAINT; Schema: adsagent; Owner: -
--

ALTER TABLE ONLY adsagent.proposals
    ADD CONSTRAINT proposals_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES adsagent.campaigns(id);


--
-- Name: proposals proposals_decided_by_fkey; Type: FK CONSTRAINT; Schema: adsagent; Owner: -
--

ALTER TABLE ONLY adsagent.proposals
    ADD CONSTRAINT proposals_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES adsagent.users(id);


--
-- Name: usage_ledger usage_ledger_org_id_fkey; Type: FK CONSTRAINT; Schema: adsagent; Owner: -
--

ALTER TABLE ONLY adsagent.usage_ledger
    ADD CONSTRAINT usage_ledger_org_id_fkey FOREIGN KEY (org_id) REFERENCES adsagent.orgs(id);


--
-- Name: usage_ledger usage_ledger_user_id_fkey; Type: FK CONSTRAINT; Schema: adsagent; Owner: -
--

ALTER TABLE ONLY adsagent.usage_ledger
    ADD CONSTRAINT usage_ledger_user_id_fkey FOREIGN KEY (user_id) REFERENCES adsagent.users(id);


--
-- Name: user_balances user_balances_org_id_fkey; Type: FK CONSTRAINT; Schema: adsagent; Owner: -
--

ALTER TABLE ONLY adsagent.user_balances
    ADD CONSTRAINT user_balances_org_id_fkey FOREIGN KEY (org_id) REFERENCES adsagent.orgs(id);


--
-- Name: user_balances user_balances_user_id_fkey; Type: FK CONSTRAINT; Schema: adsagent; Owner: -
--

ALTER TABLE ONLY adsagent.user_balances
    ADD CONSTRAINT user_balances_user_id_fkey FOREIGN KEY (user_id) REFERENCES adsagent.users(id);


--
-- Name: users users_org_id_fkey; Type: FK CONSTRAINT; Schema: adsagent; Owner: -
--

ALTER TABLE ONLY adsagent.users
    ADD CONSTRAINT users_org_id_fkey FOREIGN KEY (org_id) REFERENCES adsagent.orgs(id);


--
-- PostgreSQL database dump complete
--

\unrestrict 6tRK3Plv3ctA11u1L7LVGu18smdtzAFymqkwoj54AvfUDGHdFoSfnBCB5SuyTMj

