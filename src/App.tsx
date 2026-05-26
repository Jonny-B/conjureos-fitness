import { useAuth } from "./hooks/useAuth";
import SignIn from "./components/SignIn";
import Dashboard from "./components/Dashboard";

export default function App() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="boot">
        <span className="brand-mark spin" aria-hidden>◗</span>
      </div>
    );
  }

  return session ? <Dashboard session={session} /> : <SignIn />;
}
