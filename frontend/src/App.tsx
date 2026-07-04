import { WelcomeScreen } from './features/welcome/WelcomeScreen';

/**
 * Raíz de la app: renderiza la pantalla de bienvenida white-label. La marca
 * activa la provee `<ThemeProvider>` desde `main.tsx` (config ya resuelta).
 */
function App() {
  return <WelcomeScreen />;
}

export default App;
