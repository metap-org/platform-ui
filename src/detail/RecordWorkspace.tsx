import { useMemo, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@metap/ui";
import { GeneratedList } from "../list/GeneratedList";
import { useEntity } from "../metadata/useEntity";
import { RecordDetail } from "./RecordDetail";

export type WorkspaceTab = {
  key: string;
  label: string;
  content: ReactNode;
};

const OVERVIEW_TAB = "overview";

/**
 * A record and everything hanging off it, behind tabs — the zone-centric layout generalized to any
 * entity. "Overview" is the generic `RecordDetail` (fields, workflow actions, audit); each
 * `relatedViews` entry the entity declares becomes a tab holding a full `GeneratedList` of the
 * related entity filtered to this record (search, pagination, permission-aware buttons included),
 * and `extraTabs` adds app-specific panels. The active tab lives in the URL (`?tab=`), so a tab is
 * linkable and survives reload.
 *
 * Declaring a `RelatedView` on the entity is all an app needs for a new tab; no page code.
 */
export function RecordWorkspace({
  entityName,
  id,
  extraTabs = [],
}: {
  entityName: string;
  id: string;
  extraTabs?: WorkspaceTab[];
}) {
  const { t } = useTranslation();
  const { data: entity } = useEntity(entityName);
  const [searchParams, setSearchParams] = useSearchParams();

  const relatedTabs = useMemo<WorkspaceTab[]>(
    () =>
      (entity?.relatedViews ?? []).map((view) => ({
        key: view.name,
        label: view.label,
        content: (
          <GeneratedList
            entityName={view.entity}
            title={view.label}
            baseFilters={{ [view.filterField]: id }}
          />
        ),
      })),
    [entity, id],
  );

  const tabs: WorkspaceTab[] = [
    { key: OVERVIEW_TAB, label: t("common.overview"), content: null },
    ...relatedTabs,
    ...extraTabs,
  ];
  const requested = searchParams.get("tab");
  const active = tabs.some((tab) => tab.key === requested) ? (requested as string) : OVERVIEW_TAB;

  return (
    <Tabs
      value={active}
      onValueChange={(next) => {
        const params = new URLSearchParams(searchParams);
        if (next === OVERVIEW_TAB) params.delete("tab");
        else params.set("tab", next);
        setSearchParams(params);
      }}
    >
      <TabsList>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.key} value={tab.key}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value={OVERVIEW_TAB}>
        <RecordDetail entityName={entityName} id={id} showRelated={false} />
      </TabsContent>
      {tabs.slice(1).map((tab) => (
        <TabsContent key={tab.key} value={tab.key}>
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
