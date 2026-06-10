import { Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import Landing from './pages/Landing';
import Register from './pages/Register';
import ServiceDetail from './pages/ServiceDetail';
import Dashboard from './pages/Dashboard';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Landing />} />
        <Route path="/register" element={<Register />} />
        <Route path="/service/:id" element={<ServiceDetail />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route
          path="*"
          element={
            <div className="py-32 text-center">
              <p className="font-mono text-6xl font-bold gradient-text">404</p>
              <p className="mt-4 text-fog">This page doesn't exist in the registry.</p>
            </div>
          }
        />
      </Route>
    </Routes>
  );
}
