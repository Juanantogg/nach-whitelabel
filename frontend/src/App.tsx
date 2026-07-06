import { Routes, Route } from 'react-router-dom';
import { WelcomeScreen } from './features/welcome/WelcomeScreen';
import { RecordsList } from './features/records/RecordsList';

/**
 * Raíz de la app: declara las rutas white-label. `/` es la pantalla de bienvenida;
 * `/records` es el listado de registros (ruta NO listada en la UI, ADR 27). La
 * marca activa la provee `<ThemeProvider>` y el `<BrowserRouter>` los pone
 * `main.tsx`, de modo que ambas rutas comparten marca.
 */
function App() {
  return (
    <Routes>
      <Route path="/" element={<WelcomeScreen />} />
      <Route path="/records" element={<RecordsList />} />
    </Routes>
  );
}

export default App;
