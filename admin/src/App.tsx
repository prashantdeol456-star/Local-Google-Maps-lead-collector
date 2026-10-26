import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layout } from "./components/Layout";
import { EmptyState, ErrorBox, Spinner } from "./components/ui";
import { api, ApiError } from "./lib/api";
import { useLiveUpdates } from "./lib/live";
import { Link, matchPath, usePath } from "./lib/router";
import type { Admin } from "./lib/types";
import { CollectionDetailPage, CollectionsPage } from "./pages/CollectionsPage";
import { DashboardPage } from "./pages/DashboardPage";
import { CampaignDetailPage, EmailCampaignsPage, NewCampaignPage } from "./pages/EmailPage";
import { TemplatesPage } from "./pages/TemplatesPage";
import { NewWhatsAppCampaignPage, WhatsAppCampaignDetailPage, WhatsAppCampaignsPage } from "./pages/WhatsAppPage";
import { WhatsAppTemplatesPage } from "./pages/WhatsAppTemplatesPage";
import { OptOutsPage } from "./pages/OptOutsPage";
import { IntegrationsPage } from "./pages/IntegrationsPage";
import { LeadDetailPage } from "./pages/LeadDetailPage";
import { LeadsPage } from "./pages/LeadsPage";
import { LinkedInLeadDetailPage, LinkedInLeadsPage } from "./pages/LinkedInPage";
import { LoginPage } from "./pages/LoginPage";
import { ContactsPage } from "./pages/ContactsPage";
import { SocialAccountsPage } from "./pages/SocialAccountsPage";
import { CampaignLogsPage } from "./pages/CampaignLogsPage";
import { LinkedInCampaignDetailPage, LinkedInCampaignsPage, NewLinkedInCampaignPage } from "./pages/LinkedInOutreachPage";
import { SettingsPage } from "./pages/SettingsPage";

function Routes({ admin }: { admin: Admin }) {
  const path = usePath();
  let params: Record<string, string> | null;
  if (path === "/") return <DashboardPage />;
  if (path === "/leads") return <LeadsPage />;
  if ((params = matchPath("/leads/:id", path))) return <LeadDetailPage key={params.id} id={params.id!} />;
  if (path === "/linkedin") return <LinkedInLeadsPage />;
  if ((params = matchPath("/linkedin/:id", path))) return <LinkedInLeadDetailPage key={params.id} id={params.id!} />;
  if (path === "/contacts") return <ContactsPage />;
  if (path === "/linkedin-outreach") return <LinkedInCampaignsPage />;
  if (path === "/linkedin-outreach/new") return <NewLinkedInCampaignPage />;
  if ((params = matchPath("/linkedin-outreach/:id", path))) return <LinkedInCampaignDetailPage key={params.id} id={params.id!} />;
  if (path === "/campaign-logs") return <CampaignLogsPage />;
  if (path === "/social") return <SocialAccountsPage />;
  if (path === "/collections") return <CollectionsPage />;
  if ((params = matchPath("/collections/:id", path))) return <CollectionDetailPage key={params.id} id={params.id!} />;
  if (path === "/email") return <EmailCampaignsPage />;
  if (path === "/email/new") return <NewCampaignPage />;
  if ((params = matchPath("/email/:id", path))) return <CampaignDetailPage key={params.id} id={params.id!} />;
  if (path === "/whatsapp") return <WhatsAppCampaignsPage />;
  if (path === "/whatsapp/new") return <NewWhatsAppCampaignPage />;
  if (path === "/whatsapp/templates") return <WhatsAppTemplatesPage />;
  if ((params = matchPath("/whatsapp/:id", path))) return <WhatsAppCampaignDetailPage key={params.id} id={params.id!} />;
  if (path === "/templates") return <TemplatesPage />;
  if (path === "/opt-outs") return <OptOutsPage />;
  if (path === "/integrations") return <IntegrationsPage />;
  if (path === "/settings") return <SettingsPage admin={admin} />;
  return (
    <EmptyState title="Page not found">
      <Link to="/" className="text-brand-600 hover:underline">
        Go to the dashboard
      </Link>
    </EmptyState>
  );
}

export function App() {
  const client = useQueryClient();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return (await api<{ admin: Admin }>("/auth/me")).admin;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null; // not logged in
        throw err;
      }
    },
    retry: false,
  });
  const live = useLiveUpdates(!!me.data);

  const logout = useMutation({
    mutationFn: () => api("/auth/logout", { method: "POST" }),
    onSettled: () => {
      client.clear();
      client.setQueryData(["me"], null);
    },
  });

  if (me.isPending) return <Spinner />;
  if (me.error) {
    return (
      <div className="mx-auto max-w-md p-6">
        <ErrorBox error={me.error} />
        <button className="btn mt-4" onClick={() => me.refetch()}>
          Try again
        </button>
      </div>
    );
  }
  if (!me.data) {
    return (
      <LoginPage
        onLogin={async (email, password) => {
          const { admin } = await api<{ admin: Admin }>("/auth/login", { method: "POST", body: { email, password } });
          client.setQueryData(["me"], admin);
        }}
      />
    );
  }

  return (
    <Layout admin={me.data} live={live} onLogout={() => logout.mutate()}>
      <Routes admin={me.data} />
    </Layout>
  );
}
