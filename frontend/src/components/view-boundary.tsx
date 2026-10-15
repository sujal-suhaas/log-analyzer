import { Component, type ReactNode } from "react";
import { Button } from "./ui/button";

export class ViewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="p-4 text-sm text-destructive">
        <p>This view could not load. Reload the app to retry; locally saved files remain in this browser.</p>
        <Button className="mt-3" variant="outline" onClick={() => window.location.reload()}>Reload app</Button>
      </div>
    );
  }
}
