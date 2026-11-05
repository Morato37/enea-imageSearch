import { AuthProvider } from './contexts/AuthContext';
import { ImageArchivePage } from './pages/ImageArchivePage';

function App() {
  return (
    <AuthProvider>
      <ImageArchivePage />
    </AuthProvider>
  );
}

export default App;
