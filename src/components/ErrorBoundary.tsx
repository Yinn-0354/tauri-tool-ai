import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { Result, Button } from "antd";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <Result
          status="error"
          title="组件发生异常"
          subTitle={this.state.error?.message}
          extra={
            <Button
              type="primary"
              onClick={() => this.setState({ hasError: false, error: null })}
            >
              重试
            </Button>
          }
        />
      );
    }
    return this.props.children;
  }
}
