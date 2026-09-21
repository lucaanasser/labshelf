/**
 * Placeholder tree data providers for the Writing, Reading, Insights, Assist and Agents
 * sidebar sections. They exist so every section declared in package.json can be
 * registered during activation; each one renders a single non-interactive item stating
 * that the section is still scaffolding.
 *
 * @depends none
 * @dependents ui/sidebar/index.ts, extension.ts
 */
import * as vscode from "vscode";

class PlaceholderTreeItem extends vscode.TreeItem {
  constructor(label: string, icon: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(icon);
    this.contextValue = "labshelfPlaceholder";
    this.tooltip = "This LabShelf section has no behavior yet.";
  }
}

/**
 * Base provider that renders one fixed item. Subclasses supply the label and icon of
 * the section they stand in for.
 */
class PlaceholderTreeDataProvider
  implements vscode.TreeDataProvider<PlaceholderTreeItem>
{
  private readonly items: PlaceholderTreeItem[];

  constructor(label: string, icon: string) {
    this.items = [new PlaceholderTreeItem(label, icon)];
  }

  /**
   * Returns the tree item unchanged, as PlaceholderTreeItem already extends vscode.TreeItem.
   * @usedBy vscode TreeDataProvider API
   * @returns The same PlaceholderTreeItem passed in.
   */
  getTreeItem(element: PlaceholderTreeItem): PlaceholderTreeItem {
    return element;
  }

  /**
   * Returns the single placeholder item, and nothing below it.
   * @usedBy vscode TreeDataProvider API
   * @returns The section's placeholder item for the root level, an empty array otherwise.
   */
  getChildren(element?: PlaceholderTreeItem): PlaceholderTreeItem[] {
    return element ? [] : this.items;
  }
}

/** Placeholder provider for the labshelf.writing view. */
export class WritingTreeDataProvider extends PlaceholderTreeDataProvider {
  constructor() {
    super("No writing project yet", "edit");
  }
}

/** Placeholder provider for the labshelf.reading view. */
export class ReadingTreeDataProvider extends PlaceholderTreeDataProvider {
  constructor() {
    super("No reading session yet", "book");
  }
}

/** Placeholder provider for the labshelf.insights view. */
export class InsightsTreeDataProvider extends PlaceholderTreeDataProvider {
  constructor() {
    super("No insights yet", "lightbulb");
  }
}

/** Placeholder provider for the labshelf.assist view. */
export class AssistTreeDataProvider extends PlaceholderTreeDataProvider {
  constructor() {
    super("Assist is not available yet", "sparkle");
  }
}

/** Placeholder provider for the labshelf.agents view. */
export class AgentsTreeDataProvider extends PlaceholderTreeDataProvider {
  constructor() {
    super("No agents configured", "robot");
  }
}
