import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';

const Index = () => {
  const navigate = useNavigate();
  const { user, token } = useAuthStore();

  useEffect(() => {
    if (token && user) {
      navigate(user.role === 'admin' ? '/admin/dashboard' : '/dashboard');
    } else {
      navigate('/login');
    }
  }, [token, user, navigate]);

  return null;
};

export default Index;
