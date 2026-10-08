import { sourceForPlugins } from '@/lib/source'
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page'
import { createRelativeLink } from 'fumadocs-ui/mdx'
import { getMDXComponents } from '@/components/mdx'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params
  const page = sourceForPlugins.getPage(slug)
  if (!page) notFound()

  const MDX = page.data.body
  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX components={getMDXComponents({ a: createRelativeLink(sourceForPlugins, page) })} />
      </DocsBody>
    </DocsPage>
  )
}

export function generateStaticParams() {
  return sourceForPlugins.generateParams()
}

export async function generateMetadata({ params }: { params: Promise<{ slug?: string[] }> }): Promise<Metadata> {
  const { slug } = await params
  const page = sourceForPlugins.getPage(slug)
  if (!page) notFound()
  return { title: page.data.title, description: page.data.description }
}
