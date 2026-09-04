export type PropertyType = "text" | "textarea" | "select" | "checkbox" | "chips" | "number";

export type PropertyDef = {
  key: string;
  label: string;
  type: PropertyType;
  options?: string[];
  required?: boolean;
  hint?: string;
};

export type PropertyGroup = {
  id: string;
  label: string;
  fields: PropertyDef[];
};

/** Zoho-style ticket property catalogue. Values live in tickets.field_values. */
export const PROPERTY_GROUPS: PropertyGroup[] = [
  {
    id: "request",
    label: "Request details",
    fields: [
      {
        key: "request_type",
        label: "Request type",
        type: "select",
        required: true,
        options: ["Question", "Incident", "Service request", "Problem", "Change request", "Feature request"],
      },
      {
        key: "category",
        label: "Category",
        type: "select",
        options: ["Billing", "Access & identity", "Performance", "Data & reporting", "Integrations", "Security"],
      },
      {
        key: "sub_category",
        label: "Sub-category",
        type: "text",
      },
      { key: "classification", label: "Classification", type: "select", options: ["Task", "Bug", "Query", "Escalation"] },
      { key: "urgency", label: "Urgency", type: "select", required: true, options: ["Low", "Normal", "High", "Critical"] },
      { key: "impact", label: "Impact", type: "select", options: ["Single user", "Team", "Department", "Org-wide"] },
      { key: "impact_scope", label: "Impact scope", type: "text", hint: "Systems or tenants affected" },
      { key: "repeat_incident", label: "Repeat incident", type: "checkbox" },
    ],
  },
  {
    id: "info",
    label: "Ticket information",
    fields: [
      { key: "support_plan", label: "Support plan", type: "select", options: ["Standard", "Premium", "Enterprise", "Trial"] },
      { key: "segment", label: "Segment", type: "select", options: ["SMB", "Mid-market", "Enterprise", "MSP"] },
      { key: "customer_type", label: "Customer type", type: "select", options: ["Managed", "Self-serve", "Partner"] },
      { key: "region", label: "Region", type: "select", options: ["AMER", "EMEA", "APAC", "LATAM"] },
      { key: "language", label: "Language", type: "select", options: ["English", "German", "French", "Spanish", "Japanese"] },
      { key: "phone", label: "Phone", type: "text" },
      { key: "secondary_contacts", label: "Secondary contacts (CC)", type: "chips", hint: "Enter to add" },
      { key: "hold_reason", label: "On-hold / awaiting reason", type: "textarea" },
      { key: "proactive", label: "Proactive ticket", type: "checkbox" },
    ],
  },
  {
    id: "additional",
    label: "Additional information",
    fields: [
      { key: "product_area", label: "Product area", type: "text" },
      { key: "environment", label: "Environment", type: "select", options: ["Production", "Staging", "Sandbox"] },
      { key: "cloud", label: "Cloud / platform", type: "select", options: ["AWS", "Azure", "GCP", "On-prem", "Hybrid"] },
      { key: "external_ref", label: "External reference", type: "text", hint: "Jira / ADO work item" },
      { key: "kedb_ref", label: "KEDB reference", type: "text" },
      { key: "effort_points", label: "Effort points", type: "number" },
      {
        key: "resolution_category",
        label: "Resolution category",
        type: "select",
        options: ["Fixed", "Workaround", "Not a bug", "Duplicate", "No response", "Won't fix"],
      },
      { key: "billable", label: "Billable work", type: "checkbox" },
    ],
  },
];

export const ALL_PROPERTIES: PropertyDef[] = PROPERTY_GROUPS.flatMap((g) => g.fields);

export function propertyCompleteness(values: Record<string, string>) {
  const required = ALL_PROPERTIES.filter((f) => f.required);
  const filled = required.filter((f) => (values[f.key] ?? "").trim() !== "").length;
  return { filled, total: required.length };
}
