import { useCallback } from "react";
import { Link, redirect, useLoaderData, useNavigate } from "react-router-dom";

import { useWikiConfig } from "@/client/wiki-config";
import type { GraphData } from "@/lib/wiki-shared";
import { GraphExplorer } from "@/components/graph-explorer";
import { fetchJson, isSetupRequiredResponse } from "../api";
import { RouteErrorBoundary } from "../route-error-boundary";

export async function loader() {
  try {
    return await fetchJson<GraphData>("/api/graph");
  } catch (error) {
    if (isSetupRequiredResponse(error)) {
      throw redirect("/setup");
    }

    throw error;
  }
}

export function Component() {
  const data = useLoaderData() as GraphData;
  const config = useWikiConfig();
  const navigate = useNavigate();

  const handleOpenArticle = useCallback(
    (slug: string) => {
      navigate(`/wiki/${slug}`);
    },
    [navigate],
  );

  return (
    <div className="fixed inset-0">
      <GraphExplorer
        data={data}
        aliases={config.categories.aliases}
        conceptsLabel={config.navigation.conceptsLabel}
        connectionsLabel={config.navigation.connectionsLabel}
        onOpenArticle={handleOpenArticle}
        headerStart={
          <Link to="/" className="font-display text-lg text-[var(--foreground)] sm:text-xl">
            {config.siteTitle}
          </Link>
        }
        headerEnd={
          <Link
            to="/"
            className="surface rounded-full px-3.5 py-2 text-sm font-medium text-[var(--foreground)] transition-[transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.96] sm:px-4"
          >
            <span className="sm:hidden">Back</span>
            <span className="hidden sm:inline">{config.navigation.backToWikiLabel}</span>
          </Link>
        }
      />
    </div>
  );
}

export const ErrorBoundary = RouteErrorBoundary;
