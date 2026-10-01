import CPGenStudio from "./components/CPGenStudio";
import TitleBar from "./components/TittleBar";
import { AIProvider } from "./context/AIContext";
import { ConsoleLogsProvider } from "./context/ConsoleLogsContext";
import { PipelineProvider } from "./context/PipelineContext";
import { SettingsProvider } from "./context/SettingsContext";
import { WorkspaceProvider } from "./context/WorkspaceContext";

function App() {
  return (
    <div className="w-screen h-screen grid grid-rows-[auto_1fr] overflow-hidden antialiased">
      <TitleBar />
      <ConsoleLogsProvider>
        <WorkspaceProvider>
          <PipelineProvider>
            <SettingsProvider>
              <AIProvider>
                <CPGenStudio />
              </AIProvider>
            </SettingsProvider>
          </PipelineProvider>
        </WorkspaceProvider>
      </ConsoleLogsProvider>
    </div>
  );
}

export default App;
