import { NavLink, Route, Routes } from "react-router";
import { api } from "./api";
import { useLoad } from "./hooks";
import { Library } from "./pages/Library";
import { MissionPage } from "./pages/Mission";
import { ProjectPage } from "./pages/Project";
import { Spend } from "./pages/Spend";
import { Studio } from "./pages/Studio";
import { TakePage } from "./pages/Take";

export function App() {
  const studio = useLoad(() => api.studio(), []);
  return (
    <div className="app">
      <aside className="side">
        <NavLink to="/" className="brand" end>Reel</NavLink>
        <nav aria-label="Projects">
          {studio.data?.projects.map((p) => (
            <div key={p.key}>
              <NavLink to={`/p/${p.key}`} end className="project">{p.name}</NavLink>
              {p.missions.map((m) => (
                <NavLink key={m.key} to={`/p/${p.key}/m/${m.key}`} className="mission">{m.title}</NavLink>
              ))}
            </div>
          ))}
          <div className="group">
            <NavLink to="/library/music">Music</NavLink>
            <NavLink to="/library/voices">Voices</NavLink>
            <NavLink to="/library/effects">Effects</NavLink>
            <NavLink to="/spend">Spend</NavLink>
          </div>
        </nav>
      </aside>
      <main>
        <Routes>
          <Route path="/" element={<Studio studio={studio.data} error={studio.error} onChange={studio.reload} />} />
          <Route path="/p/:p" element={<ProjectPage onChange={studio.reload} />} />
          <Route path="/p/:p/m/:m" element={<MissionPage />} />
          <Route path="/p/:p/m/:m/t/:n" element={<TakePage />} />
          <Route path="/library/:tab" element={<Library />} />
          <Route path="/spend" element={<Spend />} />
          <Route path="*" element={<p>Nothing here. <NavLink to="/">Back to the studio</NavLink>.</p>} />
        </Routes>
      </main>
    </div>
  );
}
