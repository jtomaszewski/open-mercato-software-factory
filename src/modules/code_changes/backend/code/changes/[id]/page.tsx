import { ChangeRequestDetail } from '../../../../components/ChangeRequestDetail'

export default async function CodeChangePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ChangeRequestDetail id={id} />
}
