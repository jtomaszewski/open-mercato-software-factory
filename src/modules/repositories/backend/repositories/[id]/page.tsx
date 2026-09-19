import { RepositoryForm } from '../../../components/RepositoryForm'

export default async function RepositoryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <RepositoryForm id={id} />
}

