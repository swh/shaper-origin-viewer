import { Sidebar } from "./ui/Sidebar";
import { Scene } from "./viewer/Scene";

export function App() {
  return (
    <div className="h-full w-full flex">
      <Sidebar />
      <main className="flex-1 relative">
        <Scene />
      </main>
    </div>
  );
}
