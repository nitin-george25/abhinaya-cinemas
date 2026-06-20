// ============================================================================
// Guides — in-app help content shown on the /guides page (book icon, top-right).
//
// Data-driven on purpose: to add a guide, drop another entry into the right
// category's `guides` array. Each guide embeds a hosted walkthrough (Scribe)
// via its /embed/ URL. Categories with an empty `guides` array render an
// "coming soon" empty state, so they can be scaffolded ahead of content.
// ============================================================================

export interface Guide {
  id: string;
  title: string;
  description?: string;
  /** Embeddable walkthrough URL (e.g. a Scribe /embed/ link). */
  embedUrl: string;
}

export interface GuideCategory {
  id: string;
  label: string;
  guides: Guide[];
}

export const GUIDE_CATEGORIES: GuideCategory[] = [
  {
    id: "box-office",
    label: "Box Office",
    guides: [],
  },
  {
    id: "fb",
    label: "F&B",
    guides: [
      {
        id: "fb-upload-daily-sales",
        title: "Upload Daily Sales",
        description:
          "Export the day's F&B sales report from the POS and upload it into the console.",
        embedUrl:
          "https://scribehow.com/embed/How_to_Export_and_Upload_Daily_FandB_Sales_Reports__pG1UuQZdQrCcczaabZyCrQ",
      },
    ],
  },
  {
    id: "cash",
    label: "Cash",
    guides: [],
  },
  {
    id: "finance",
    label: "Finance",
    guides: [],
  },
  {
    id: "operations",
    label: "Operations",
    guides: [
      {
        id: "ops-create-daily-manager-roster",
        title: "Create a Daily Manager Roster",
        description:
          "Set up the daily manager roster so each shift has an assigned manager in the console.",
        embedUrl:
          "https://scribehow.com/embed/How_To_Create_A_Daily_Manager_Roster__PV8ujNtxSbONP8YQBW2W-g",
      },
      {
        id: "ops-add-renovation-expense",
        title: "Add a New Expense to a Renovation Project",
        description:
          "Record a new expense against a renovation project's budget from the Project Management module.",
        embedUrl:
          "https://scribehow.com/embed/How_To_Add_A_New_Expense_To_A_Renovation_Project__xJ_Klrr_QzK2vVIlrSxJcQ",
      },
    ],
  },
];
