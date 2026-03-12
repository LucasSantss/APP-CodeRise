import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

const AdminSettings = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Configurações</h1>
        <p className="text-muted-foreground">Configurações globais da plataforma</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>API Backend</CardTitle>
          <CardDescription>Configure a URL do backend para conectar esta interface</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>URL da API</Label>
            <Input placeholder="https://seu-dominio.vercel.app" />
          </div>
          <div className="space-y-2">
            <Label>Admin Secret</Label>
            <Input type="password" placeholder="Senha mestra" />
          </div>
          <Button>Salvar Configurações</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Inicializar Banco</CardTitle>
          <CardDescription>Execute o setup para criar as tabelas e o admin padrão</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline">Executar Setup</Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminSettings;
